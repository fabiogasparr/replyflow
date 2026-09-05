import { randomUUID } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { z } from "zod";

export const CONVERSATION_NOTES_MAX_LENGTH = 5_000;
export const CONVERSATION_MESSAGE_MAX_LENGTH = 1_000;

export type ExternalConversationSnapshot = {
  metaConversationId: string;
  contact: { instagramScopedId: string; username: string | null };
  updatedTime: string | null;
  lastMessage: {
    text: string;
    fromMe: boolean;
    createdTime: string | null;
  } | null;
};

export const conversationStateSelect = {
  id: true,
  metaConversationId: true,
  status: true,
  priority: true,
  assignedMemberId: true,
  notes: true,
  version: true,
  lastInboundAt: true,
  lastSyncedAt: true,
  assignedMember: {
    select: {
      id: true,
      user: { select: { id: true, name: true, email: true } },
    },
  },
} as const;

export const updateConversationSchema = z.strictObject({
  version: z.number().int().min(0).max(2_147_483_646),
  status: z.enum(["OPEN", "PENDING", "RESOLVED"]).optional(),
  priority: z.enum(["NORMAL", "HIGH"]).optional(),
  assignedMemberId: z.string().trim().min(1).max(100).nullable().optional(),
  notes: z.string().max(CONVERSATION_NOTES_MAX_LENGTH).trim().nullable()
    .transform((value) => value || null).optional(),
}).refine(
  ({ status, priority, assignedMemberId, notes }) =>
    status !== undefined || priority !== undefined || assignedMemberId !== undefined || notes !== undefined,
  { message: "Informe ao menos uma alteração para a conversa." },
);

export const sendConversationMessageSchema = z.strictObject({
  instagramAccountId: z.string().trim().min(1).max(100),
  recipientId: z.string().trim().min(1).max(200),
  conversationId: z.string().trim().min(1).max(200).optional(),
  text: z.string().trim().min(1).max(CONVERSATION_MESSAGE_MAX_LENGTH),
});

function observedAt(snapshot: ExternalConversationSnapshot) {
  const candidates = [snapshot.lastMessage?.createdTime, snapshot.updatedTime];
  for (const value of candidates) {
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * Persist the team-owned projection without storing Meta's full message history.
 * Conditional SQL keeps usernames and timestamps correct when polling requests
 * overlap or Meta returns an older snapshot after a newer one.
 */
export async function syncConversationSnapshots(
  workspaceId: string,
  instagramAccountId: string,
  snapshots: ExternalConversationSnapshot[],
) {
  const validSnapshots = snapshots.filter(
    (snapshot) => snapshot.metaConversationId && snapshot.contact.instagramScopedId,
  );
  if (validSnapshots.length === 0) return [];

  return prisma.$transaction(async (transaction) => {
    for (const snapshot of validSnapshots) {
      const timestamp = observedAt(snapshot);
      const username = snapshot.contact.username?.trim() || null;
      const contacts = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO "Contact" (
          "id", "workspaceId", "instagramAccountId", "instagramScopedId",
          "username", "usernameObservedAt", "firstSeenAt", "lastSeenAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}, ${workspaceId}, ${instagramAccountId}, ${snapshot.contact.instagramScopedId},
          ${username}, ${username ? timestamp : null}, ${timestamp}, ${timestamp}, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("workspaceId", "instagramAccountId", "instagramScopedId")
        DO UPDATE SET
          "firstSeenAt" = LEAST("Contact"."firstSeenAt", EXCLUDED."firstSeenAt"),
          "lastSeenAt" = GREATEST("Contact"."lastSeenAt", EXCLUDED."lastSeenAt"),
          "username" = CASE
            WHEN EXCLUDED."usernameObservedAt" IS NOT NULL AND (
              "Contact"."usernameObservedAt" IS NULL
              OR EXCLUDED."usernameObservedAt" >= "Contact"."usernameObservedAt"
            ) THEN EXCLUDED."username"
            ELSE "Contact"."username"
          END,
          "usernameObservedAt" = CASE
            WHEN EXCLUDED."usernameObservedAt" IS NOT NULL AND (
              "Contact"."usernameObservedAt" IS NULL
              OR EXCLUDED."usernameObservedAt" >= "Contact"."usernameObservedAt"
            ) THEN EXCLUDED."usernameObservedAt"
            ELSE "Contact"."usernameObservedAt"
          END,
          "updatedAt" = CURRENT_TIMESTAMP
        RETURNING "id"
      `);
      const contactId = contacts[0]?.id;
      if (!contactId) throw new Error("Conversation contact synchronization returned no contact");

      const conversation = await transaction.conversation.upsert({
        where: {
          workspaceId_instagramAccountId_metaConversationId: {
            workspaceId,
            instagramAccountId,
            metaConversationId: snapshot.metaConversationId,
          },
        },
        create: {
          workspaceId,
          instagramAccountId,
          contactId,
          metaConversationId: snapshot.metaConversationId,
          lastMessageText: snapshot.lastMessage?.text ?? null,
          lastMessageAt: timestamp,
          lastMessageFromMe: snapshot.lastMessage?.fromMe ?? null,
          lastInboundAt: snapshot.lastMessage && !snapshot.lastMessage.fromMe ? timestamp : null,
        },
        update: {
          contactId,
          lastSyncedAt: new Date(),
        },
        select: { id: true },
      });

      await transaction.conversation.updateMany({
        where: {
          id: conversation.id,
          workspaceId,
          OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: timestamp } }],
        },
        data: {
          lastMessageText: snapshot.lastMessage?.text ?? null,
          lastMessageAt: timestamp,
          lastMessageFromMe: snapshot.lastMessage?.fromMe ?? null,
        },
      });

      if (snapshot.lastMessage && !snapshot.lastMessage.fromMe) {
        await transaction.conversation.updateMany({
          where: {
            id: conversation.id,
            workspaceId,
            OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: timestamp } }],
          },
          data: { lastInboundAt: timestamp },
        });
      }
    }

    return transaction.conversation.findMany({
      where: {
        workspaceId,
        instagramAccountId,
        metaConversationId: { in: validSnapshots.map((snapshot) => snapshot.metaConversationId) },
      },
      select: conversationStateSelect,
    });
  });
}

export function buildMessagingWindow(lastInboundAt: Date | string | null) {
  if (!lastInboundAt) return { lastInboundAt: null, expiresAt: null, isOpen: false };
  const inbound = new Date(lastInboundAt);
  if (Number.isNaN(inbound.getTime())) {
    return { lastInboundAt: null, expiresAt: null, isOpen: false };
  }
  const expiresAt = new Date(inbound.getTime() + 24 * 60 * 60 * 1_000);
  return {
    lastInboundAt: inbound.toISOString(),
    expiresAt: expiresAt.toISOString(),
    isOpen: Date.now() <= expiresAt.getTime(),
  };
}
