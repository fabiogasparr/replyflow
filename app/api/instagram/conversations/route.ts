import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { hasWorkspacePermission } from "@/lib/workspace-permissions";
import {
  sendConversationMessageSchema,
  syncConversationSnapshots,
} from "@/lib/conversations";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import {
  getConversations,
  sendDirectMessage,
  MetaApiError,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";

export interface ConversationListItem {
  id: string;
  contact: { id: string; username: string | null };
  updatedTime: string | null;
  lastMessage: {
    text: string;
    fromMe: boolean;
    createdTime: string | null;
  } | null;
  state: {
    id: string;
    status: "OPEN" | "PENDING" | "RESOLVED";
    priority: "NORMAL" | "HIGH";
    assignedMemberId: string | null;
    notes: string | null;
    version: number;
    lastInboundAt: string | null;
    lastSyncedAt: string;
    assignedMember: {
      id: string;
      user: { id: string; name: string | null; email: string | null };
    } | null;
  } | null;
}

export interface ConversationsResponse {
  conversations: ConversationListItem[];
  account: { id: string; username: string; instagramId: string };
  members: Array<{
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    user: { id: string; name: string | null; email: string | null };
  }>;
  canReply: boolean;
}

// List the account's DM conversations for the inbox.
export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

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
    const raw = await getConversations(accessToken, account.instagramId);

    const snapshots = raw.map((c) => {
      const participants = c.participants?.data ?? [];
      const contact =
        participants.find((p) => p.id !== account.instagramId) ??
        participants[0] ??
        null;
      const last = c.messages?.data?.[0] ?? null;

      return {
        metaConversationId: c.id,
        contact: {
          instagramScopedId: contact?.id ?? "",
          username: contact?.username ?? null,
        },
        updatedTime: c.updated_time ?? null,
        lastMessage: last
          ? {
              text: last.message ?? "",
              fromMe: last.from?.id === account.instagramId,
              createdTime: last.created_time ?? null,
            }
          : null,
      };
    });

    const [states, members] = await Promise.all([
      syncConversationSnapshots(context.workspaceId, account.id, snapshots),
      prisma.workspaceMember.findMany({
        where: { workspaceId: context.workspaceId },
        select: {
          id: true,
          role: true,
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    const stateByMetaId = new Map(states.map((state) => [state.metaConversationId, state]));
    const conversations: ConversationListItem[] = snapshots.map((snapshot) => {
      const state = stateByMetaId.get(snapshot.metaConversationId);
      return {
        id: snapshot.metaConversationId,
        contact: {
          id: snapshot.contact.instagramScopedId,
          username: snapshot.contact.username,
        },
        updatedTime: snapshot.updatedTime,
        lastMessage: snapshot.lastMessage,
        state: state ? {
          ...state,
          lastInboundAt: state.lastInboundAt?.toISOString() ?? null,
          lastSyncedAt: state.lastSyncedAt.toISOString(),
        } : null,
      };
    });

    const data: ConversationsResponse = {
      conversations,
      account: {
        id: account.id,
        username: account.username,
        instagramId: account.instagramId,
      },
      members,
      canReply: hasWorkspacePermission(context.role, "inbox:reply"),
    };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Conversations] Error:", err);
    const message =
      err instanceof MetaApiError
        ? err.message
        : "Não foi possível carregar as conversas";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Send a direct message reply.
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  if (!hasWorkspacePermission(context.role, "inbox:reply")) {
    return NextResponse.json(
      { success: false, error: "Seu perfil não pode responder conversas" },
      { status: 403 }
    );
  }

  const parsed = sendConversationMessageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Informe conta, destinatário e uma mensagem de até 1.000 caracteres." },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const account = await getWorkspaceInstagramAccount(
    context.workspaceId,
    body.instagramAccountId,
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Conta do Instagram não conectada." },
      { status: 400 }
    );
  }

  try {
    const accessToken = decryptToken(account.accessToken);
    const result = await sendDirectMessage(
      accessToken,
      account.instagramId,
      body.recipientId,
      body.text
    );
    if (body.conversationId) {
      try {
        await prisma.$transaction(async (transaction) => {
          const conversation = await transaction.conversation.findFirst({
            where: {
              workspaceId: context.workspaceId,
              instagramAccountId: account.id,
              metaConversationId: body.conversationId,
            },
            select: { id: true },
          });
          if (!conversation) return;
          const sentAt = new Date();
          await transaction.conversation.update({
            where: { id: conversation.id },
            data: {
              lastMessageText: body.text,
              lastMessageAt: sentAt,
              lastMessageFromMe: true,
              lastSyncedAt: sentAt,
            },
          });
          await transaction.auditEvent.create({
            data: createAuditEventData({
              workspaceId: context.workspaceId,
              actorUserId: context.userId,
              action: AUDIT_ACTIONS.conversationMessageSent,
              targetType: "Conversation",
              targetId: conversation.id,
              metadata: { channel: "INSTAGRAM" },
            }),
          });
        });
      } catch (persistenceError) {
        // The Meta send already succeeded. Never report a failure that could
        // make the operator retry and send the same message twice.
        console.error("[Conversations] Sent message state persistence failed:", persistenceError);
      }
    }
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error("[Conversations] Send error:", err);
    // Surface Meta's own message — the common case is the 24-hour messaging
    // window having closed, which the user needs to see explicitly.
    const message =
      err instanceof MetaApiError ? err.message : "Não foi possível enviar a mensagem";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
