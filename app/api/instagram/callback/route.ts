import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import { getLongLivedToken, getUserInfo, subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";
import {
  encryptToken,
  exchangeCodeForToken,
  verifyOAuthState,
} from "@/lib/meta/oauth";
import { canManageInstagram } from "@/lib/workspace-access";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));
  const baseUrl = getBaseUrl();

  if (error) {
    return NextResponse.redirect(`${baseUrl}/settings?instagram=denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/settings?instagram=invalid`);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${baseUrl}/login`);
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: state.workspaceId,
      userId: session.user.id,
    },
  });

  if (!membership || !canManageInstagram(membership.role)) {
    return NextResponse.redirect(`${baseUrl}/settings?instagram=forbidden`);
  }

  try {
    const redirectUri = `${baseUrl}/api/instagram/callback`;
    const { accessToken: shortLivedToken } = await exchangeCodeForToken(
      code,
      redirectUri
    );
    const { accessToken: longLivedToken, expiresIn } =
      await getLongLivedToken(shortLivedToken);
    const userInfo = await getUserInfo(longLivedToken);
    // Webhooks and the messaging API key off the professional account ID
    // (user_id), not the app-scoped `id`. Store user_id so comment webhooks
    // can be matched back to this account. Fall back to id if user_id is
    // ever absent.
    const instagramId = userInfo.user_id ?? userInfo.id;
    const connection = await canConnectInstagramAccount({
      workspaceId: state.workspaceId,
      instagramId,
    });

    if (!connection.allowed) {
      return NextResponse.redirect(
        `${baseUrl}/settings?instagram=already_connected`
      );
    }

    const encryptedToken = encryptToken(longLivedToken);
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    let webhookSubscribed = false;
    try {
      const subscription = await subscribeInstagramAccountToWebhooks(
        instagramId,
        longLivedToken
      );
      webhookSubscribed = Boolean(subscription.success);
    } catch (subscriptionError) {
      console.warn(
        "[Instagram Callback] Webhook subscription failed:",
        subscriptionError
      );
    }

    await prisma.$transaction(async (transaction) => {
      const currentMembership = await transaction.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: state.workspaceId,
            userId: session.user.id,
          },
        },
        select: { role: true },
      });
      if (!currentMembership || !canManageInstagram(currentMembership.role)) {
        throw new Error("Workspace permission changed during Instagram connection");
      }

      const existingAccount = await transaction.instagramAccount.findUnique({
        where: { instagramId },
      });
      if (
        existingAccount &&
        existingAccount.workspaceId !== state.workspaceId
      ) {
        throw new Error(
          "Instagram account already connected to another workspace"
        );
      }

      const account = existingAccount
        ? await transaction.instagramAccount.update({
            where: { id: existingAccount.id, workspaceId: state.workspaceId },
            data: {
              username: userInfo.username,
              name: userInfo.name,
              accessToken: encryptedToken,
              tokenExpiresAt,
              webhookSubscribed,
            },
          })
        : await transaction.instagramAccount.create({
            data: {
              workspaceId: state.workspaceId,
              instagramId,
              username: userInfo.username,
              name: userInfo.name,
              accessToken: encryptedToken,
              tokenExpiresAt,
              webhookSubscribed,
            },
          });
      await transaction.auditEvent.create({
        data: createAuditEventData({
          workspaceId: state.workspaceId,
          actorUserId: session.user.id,
          action: AUDIT_ACTIONS.instagramConnected,
          targetType: "InstagramAccount",
          targetId: account.id,
          metadata: {
            username: account.username,
            webhookSubscribed: account.webhookSubscribed,
          },
        }),
      });
    });

    return NextResponse.redirect(`${baseUrl}/dashboard?connected=true`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Instagram Callback] Error:", err);
    // The message is the only diagnostic a self-hoster gets for a failed
    // connect, so persist it alongside the other operational events rather
    // than leaving it in server logs they may not be able to reach.
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "ERROR",
          workspaceId: state.workspaceId,
          message: "Instagram connection failed",
          payload: { reason: message },
        },
      })
      .catch(() => {});

    return NextResponse.redirect(
      `${baseUrl}/settings?instagram=failed&reason=${encodeURIComponent(
        message.slice(0, 200)
      )}`
    );
  }
}
