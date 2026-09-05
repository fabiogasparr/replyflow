import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { hasWorkspacePermission } from "@/lib/workspace-permissions";
import { getConversationMessages, MetaApiError } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  buildMessagingWindow,
  conversationStateSelect,
  updateConversationSchema,
} from "@/lib/conversations";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";

export interface ThreadMessage {
  id: string;
  text: string;
  fromMe: boolean;
  fromUsername: string | null;
  createdTime: string | null;
}

export interface ThreadResponse {
  messages: ThreadMessage[];
  messagingWindow: ReturnType<typeof buildMessagingWindow>;
}

type RouteProps = { params: Promise<{ id: string }> };

// Message history for a single conversation (20 most recent, chronological).
export async function GET(request: NextRequest, { params }: RouteProps) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  const { id: conversationId } = await params;

  const account = await getWorkspaceInstagramAccount(
    context.workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Conta do Instagram não conectada." },
      { status: 400 }
    );
  }

  try {
    const accessToken = decryptToken(account.accessToken);
    const raw = await getConversationMessages(accessToken, conversationId);

    // The API returns newest-first; reverse to read top-to-bottom.
    const messages: ThreadMessage[] = raw
      .map((m) => ({
        id: m.id,
        text: m.message ?? "",
        fromMe: m.from?.id === account.instagramId,
        fromUsername: m.from?.username ?? null,
        createdTime: m.created_time ?? null,
      }))
      .reverse();

    const latestInboundAt = raw.reduce<Date | null>((latest, message) => {
      if (message.from?.id === account.instagramId || !message.created_time) return latest;
      const timestamp = new Date(message.created_time);
      if (Number.isNaN(timestamp.getTime())) return latest;
      return !latest || timestamp > latest ? timestamp : latest;
    }, null);
    if (latestInboundAt) {
      await prisma.conversation.updateMany({
        where: {
          workspaceId: context.workspaceId,
          instagramAccountId: account.id,
          metaConversationId: conversationId,
          OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: latestInboundAt } }],
        },
        data: { lastInboundAt: latestInboundAt, lastSyncedAt: new Date() },
      });
    }
    const stored = await prisma.conversation.findFirst({
      where: {
        workspaceId: context.workspaceId,
        instagramAccountId: account.id,
        metaConversationId: conversationId,
      },
      select: { lastInboundAt: true },
    });

    const data: ThreadResponse = {
      messages,
      messagingWindow: buildMessagingWindow(stored?.lastInboundAt ?? latestInboundAt),
    };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Conversation Messages] Error:", err);
    const message =
      err instanceof MetaApiError ? err.message : "Não foi possível carregar as mensagens";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 },
    );
  }
  if (!hasWorkspacePermission(context.role, "inbox:reply")) {
    return NextResponse.json(
      { success: false, error: "Seu perfil não pode organizar conversas" },
      { status: 403 },
    );
  }

  const parsed = updateConversationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Dados da conversa inválidos" },
      { status: 400 },
    );
  }

  const { id: metaConversationId } = await params;
  const account = await getWorkspaceInstagramAccount(
    context.workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId"),
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Conta do Instagram não conectada." },
      { status: 400 },
    );
  }

  const { version, status, priority, assignedMemberId, notes } = parsed.data;
  if (assignedMemberId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { id: assignedMemberId, workspaceId: context.workspaceId },
      select: { id: true },
    });
    if (!member) {
      return NextResponse.json(
        { success: false, error: "O responsável não pertence a este espaço de trabalho" },
        { status: 400 },
      );
    }
  }

  const result = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.conversation.findFirst({
      where: {
        workspaceId: context.workspaceId,
        instagramAccountId: account.id,
        metaConversationId,
      },
      select: { id: true },
    });
    if (!existing) return { status: "missing" as const };

    const updated = await transaction.conversation.updateMany({
      where: {
        id: existing.id,
        workspaceId: context.workspaceId,
        instagramAccountId: account.id,
        version,
      },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(assignedMemberId !== undefined ? { assignedMemberId } : {}),
        ...(notes !== undefined ? { notes } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return { status: "conflict" as const };

    const conversation = await transaction.conversation.findFirst({
      where: { id: existing.id, workspaceId: context.workspaceId },
      select: conversationStateSelect,
    });
    if (!conversation) throw new Error("Conversation disappeared during update transaction");

    await transaction.auditEvent.create({
      data: createAuditEventData({
        workspaceId: context.workspaceId,
        actorUserId: context.userId,
        action: AUDIT_ACTIONS.conversationUpdated,
        targetType: "Conversation",
        targetId: existing.id,
        metadata: {
          fields: [
            ...(status !== undefined ? ["status"] : []),
            ...(priority !== undefined ? ["priority"] : []),
            ...(assignedMemberId !== undefined ? ["assignedMemberId"] : []),
            ...(notes !== undefined ? ["notes"] : []),
          ],
        },
      }),
    });

    return { status: "updated" as const, conversation };
  });

  if (result.status === "missing") {
    return NextResponse.json(
      { success: false, error: "Conversa não encontrada" },
      { status: 404 },
    );
  }
  if (result.status === "conflict") {
    return NextResponse.json({
      success: false,
      code: "CONVERSATION_VERSION_CONFLICT",
      error: "Esta conversa foi atualizada por outra pessoa. Recarregue antes de salvar.",
    }, { status: 409 });
  }

  return NextResponse.json({ success: true, data: { conversation: result.conversation } });
}
