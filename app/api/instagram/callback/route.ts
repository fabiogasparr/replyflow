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
  INSTAGRAM_STATE_COOKIE,
} from "@/lib/meta/oauth";
import { canManageInstagram } from "@/lib/workspace-access";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import {
  assertWorkspacePlanCapacity,
  WorkspaceBillingSetupError,
  WorkspacePlanLimitError,
} from "@/lib/billing/plans";
import { clearAutomationCredentialFailures } from "@/lib/automations/operational-state";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const rawState = request.nextUrl.searchParams.get("state");
  const state = rawState && request.cookies.get(INSTAGRAM_STATE_COOKIE)?.value === rawState
    ? verifyOAuthState(rawState) : null;
  const baseUrl = getBaseUrl();
  function redirect(url: string) {
    const response = NextResponse.redirect(url);
    response.cookies.set(INSTAGRAM_STATE_COOKIE, "", {
      httpOnly: true, secure: baseUrl.startsWith("https://"), sameSite: "lax",
      path: "/api/instagram/callback", maxAge: 0,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  if (error) {
    return redirect(`${baseUrl}/settings?instagram=denied`);
  }

  if (!code || !state) {
    return redirect(`${baseUrl}/settings?instagram=invalid`);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return redirect(`${baseUrl}/login`);
  }
  if (state.userId !== session.user.id) {
    return redirect(`${baseUrl}/settings?instagram=invalid`);
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: state.workspaceId,
      userId: session.user.id,
      workspace: { archivedAt: null },
    },
  });

  if (!membership || !canManageInstagram(membership.role)) {
    return redirect(`${baseUrl}/settings?instagram=forbidden`);
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
      const status =
        connection.reason === "plan_limit"
          ? "plan_limit"
          : connection.reason === "billing_setup"
            ? "billing_setup"
          : connection.reason === "already_connected"
            ? "already_connected"
            : "failed";
      return redirect(
        `${baseUrl}/settings?instagram=${status}`
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
    } catch {
      console.warn(
        "[Instagram Callback] Webhook subscription failed; reconnect to retry."
      );
    }

    await prisma.$transaction(async (transaction) => {
      const currentMembership = await transaction.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: state.workspaceId,
            userId: session.user.id,
          },
          workspace: { archivedAt: null },
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

      if (!existingAccount) {
        const workspace = await transaction.workspace.findUnique({
          where: { id: state.workspaceId },
          select: {
            subscription: {
              select: {
                plan: { select: { instagramAccounts: true } },
              },
            },
            _count: { select: { instagramAccounts: true } },
          },
        });
        if (!workspace) {
          throw new Error("Workspace not found during Instagram connection");
        }
        if (!workspace.subscription) {
          throw new WorkspaceBillingSetupError();
        }
        assertWorkspacePlanCapacity(
          "instagramAccounts",
          workspace._count.instagramAccounts,
          workspace.subscription.plan.instagramAccounts
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

      await clearAutomationCredentialFailures(
        transaction,
        state.workspaceId,
        account.id
      );
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
    }, { isolationLevel: "Serializable" });

    return redirect(`${baseUrl}/dashboard?connected=true`);
  } catch (err) {
    if (err instanceof WorkspacePlanLimitError) {
      return redirect(`${baseUrl}/settings?instagram=plan_limit`);
    }
    if (err instanceof WorkspaceBillingSetupError) {
      return redirect(`${baseUrl}/settings?instagram=billing_setup`);
    }

    const message = "Falha ao conectar Instagram. Verifique configuração, permissões e disponibilidade da Meta.";
    console.error("[Instagram Callback] Connection failed");
    // Remote errors may contain tokens: persist only a fixed safe description.
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

    return redirect(`${baseUrl}/settings?instagram=failed`);
  }
}
