import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import {
  buildDeletionStatusUrl,
  generateConfirmationCode,
  getMetaAppSecrets,
  parseSignedRequest,
} from "@/lib/meta/data-deletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta Data Deletion Request callback.
 *
 * Meta calls this when a person removes ReplyFlow from their Instagram or
 * Facebook settings and asks for their data to be deleted. The `user_id` in
 * the signed request is the app-scoped id of the professional account that
 * authorised the app, so deletion means removing that Instagram connection
 * from ReplyFlow — automations, delivery logs, contacts and conversations
 * hang off it and cascade. The confirmation code is stored in a SYSTEM
 * operational event so the status page can answer "what happened to my
 * request?" later on.
 */
export async function POST(request: NextRequest) {
  const signedRequest = await readSignedRequest(request);
  const payload = parseSignedRequest(signedRequest, getMetaAppSecrets());
  if (!payload) {
    return NextResponse.json(
      { success: false, error: "Assinatura inválida" },
      { status: 400 }
    );
  }

  const userId = typeof payload.user_id === "string" ? payload.user_id : null;
  const confirmationCode = generateConfirmationCode();
  const receivedAt = new Date().toISOString();

  const accounts = userId
    ? await prisma.instagramAccount.findMany({
        where: { instagramId: userId },
        select: { id: true, workspaceId: true, username: true },
      })
    : [];

  await prisma.$transaction(async (transaction) => {
    if (accounts.length > 0) {
      await transaction.instagramAccount.deleteMany({
        where: { id: { in: accounts.map((account) => account.id) } },
      });
      for (const account of accounts) {
        await transaction.auditEvent.create({
          data: createAuditEventData({
            workspaceId: account.workspaceId,
            actorUserId: null,
            action: AUDIT_ACTIONS.instagramDisconnected,
            targetType: "InstagramAccount",
            targetId: account.id,
            metadata: {
              username: account.username,
              reason: "META_DATA_DELETION_REQUEST",
              confirmationCode,
            },
          }),
        });
      }
    }
    await transaction.operationalEvent.create({
      data: {
        workspaceId: accounts[0]?.workspaceId ?? null,
        source: "SYSTEM",
        level: "INFO",
        message: accounts.length
          ? `Solicitação de exclusão de dados da Meta atendida (${accounts.length} conta(s) removida(s))`
          : "Solicitação de exclusão de dados da Meta recebida (nenhuma conta conectada)",
        payload: {
          kind: "META_DATA_DELETION",
          confirmationCode,
          userId,
          receivedAt,
          status: "COMPLETED",
          removedAccounts: accounts.map((account) => account.username),
        },
      },
    });
  });

  return NextResponse.json({
    url: buildDeletionStatusUrl(getBaseUrl(), confirmationCode),
    confirmation_code: confirmationCode,
  });
}

/** Meta's dashboard validator and curious humans GET the URL; answer plainly. */
export async function GET() {
  return NextResponse.json({
    service: "ReplyFlow",
    endpoint: "meta-data-deletion-callback",
    method: "POST",
    instructions: `${getBaseUrl()}/data-deletion`,
  });
}

async function readSignedRequest(request: NextRequest): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { signed_request?: unknown };
      return typeof body.signed_request === "string" ? body.signed_request : null;
    }
    const form = await request.formData();
    const value = form.get("signed_request");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
