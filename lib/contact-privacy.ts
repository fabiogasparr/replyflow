import { randomBytes } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import { prisma } from "@/lib/db/client";

const REMOVED_CONTENT = "[conteúdo removido por solicitação de privacidade]";

export class ContactPrivacyError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    public readonly code: "CONTACT_NOT_FOUND" | "CONTACT_VERSION_CONFLICT" | "INVALID_CONFIRMATION",
    message: string,
  ) {
    super(message);
    this.name = "ContactPrivacyError";
  }
}

export function contactDeletionConfirmation(contact: {
  username: string | null;
  instagramScopedId: string;
}) {
  return contact.username
    ? `EXCLUIR @${contact.username}`
    : `EXCLUIR ${contact.instagramScopedId}`;
}

const scopedContactWhere = (workspaceId: string, contactId: string) => ({
  id: contactId,
  workspaceId,
  instagramAccount: { workspaceId },
});

export async function getContactPrivacyExport(input: {
  workspaceId: string;
  contactId: string;
  actorUserId: string;
}) {
  return prisma.$transaction(async (transaction) => {
    const contact = await transaction.contact.findFirst({
      where: scopedContactWhere(input.workspaceId, input.contactId),
      select: {
        id: true,
        instagramAccountId: true,
        instagramScopedId: true,
        username: true,
        usernameObservedAt: true,
        tags: true,
        notes: true,
        firstSeenAt: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true,
        workspace: { select: { id: true, name: true } },
        instagramAccount: { select: { id: true, username: true } },
        conversations: {
          orderBy: [{ lastMessageAt: "desc" }, { id: "asc" }],
          select: {
            id: true,
            metaConversationId: true,
            status: true,
            priority: true,
            notes: true,
            lastMessageText: true,
            lastMessageAt: true,
            lastMessageFromMe: true,
            lastInboundAt: true,
            lastSyncedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        customFieldValues: {
          orderBy: [{ fieldDefinition: { position: "asc" } }, { id: "asc" }],
          select: {
            value: true,
            createdAt: true,
            updatedAt: true,
            fieldDefinition: {
              select: { id: true, name: true, type: true, options: true, isActive: true },
            },
          },
        },
      },
    });
    if (!contact) {
      throw new ContactPrivacyError(404, "CONTACT_NOT_FOUND", "Contato não encontrado");
    }

    const interactions = await transaction.dmLog.findMany({
      where: {
        workspaceId: input.workspaceId,
        instagramAccountId: contact.instagramAccountId,
        commenterId: contact.instagramScopedId,
        instagramAccount: { workspaceId: input.workspaceId },
        automation: {
          workspaceId: input.workspaceId,
          instagramAccountId: contact.instagramAccountId,
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        commenterId: true,
        commenterName: true,
        commentText: true,
        commentId: true,
        matchedKeyword: true,
        status: true,
        attempts: true,
        dmSentAt: true,
        triggerType: true,
        sourceEventId: true,
        sourceMediaId: true,
        originalMediaId: true,
        source: true,
        deliveryAttemptedAt: true,
        manualRetryCount: true,
        lastManualRetryAt: true,
        publicReplySentAt: true,
        createdAt: true,
        updatedAt: true,
        automation: { select: { id: true, name: true } },
      },
    });
    const processedComments = interactions.length === 0
      ? []
      : await transaction.processedComment.findMany({
          where: {
            instagramAccountId: contact.instagramAccountId,
            commentId: { in: interactions.map((interaction) => interaction.commentId) },
          },
          orderBy: [{ seenAt: "asc" }, { id: "asc" }],
          select: { id: true, commentId: true, source: true, seenAt: true },
        });

    await transaction.auditEvent.create({
      data: createAuditEventData({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.contactDataExported,
        targetType: "Contact",
        targetId: input.contactId,
        metadata: {
          interactionCount: interactions.length,
          conversationCount: contact.conversations.length,
          processedCommentCount: processedComments.length,
          customFieldValueCount: contact.customFieldValues.length,
        },
      }),
    });

    return {
      format: "replyflow-contact-data-export",
      version: 1,
      generatedAt: new Date().toISOString(),
      scope: {
        workspace: contact.workspace,
        instagramAccount: contact.instagramAccount,
      },
      contact: {
        id: contact.id,
        instagramScopedId: contact.instagramScopedId,
        username: contact.username,
        usernameObservedAt: contact.usernameObservedAt,
        tags: contact.tags,
        notes: contact.notes,
        firstSeenAt: contact.firstSeenAt,
        lastSeenAt: contact.lastSeenAt,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
      },
      conversations: contact.conversations,
      customFields: contact.customFieldValues,
      automationInteractions: interactions,
      processedComments,
      limitations: [
        "O ReplyFlow não mantém o histórico completo das mensagens do Instagram; ele permanece na Meta.",
        "Cliques agregados não são incluídos porque não possuem vínculo técnico com este contato.",
      ],
    };
  }, { isolationLevel: "RepeatableRead" });
}

export async function anonymizeContactPersonalData(input: {
  workspaceId: string;
  contactId: string;
  actorUserId: string;
  version: number;
  confirmation: string;
}) {
  const tombstoneId = `deleted:${randomBytes(16).toString("hex")}`;

  return prisma.$transaction(async (transaction) => {
    const contact = await transaction.contact.findFirst({
      where: scopedContactWhere(input.workspaceId, input.contactId),
      select: {
        id: true,
        version: true,
        username: true,
        instagramScopedId: true,
        instagramAccountId: true,
        _count: { select: { conversations: true } },
      },
    });
    if (!contact) {
      throw new ContactPrivacyError(404, "CONTACT_NOT_FOUND", "Contato não encontrado");
    }
    if (contact.version !== input.version) {
      throw new ContactPrivacyError(
        409,
        "CONTACT_VERSION_CONFLICT",
        "Este contato foi atualizado por outra pessoa. Recarregue os dados antes de continuar.",
      );
    }
    if (input.confirmation !== contactDeletionConfirmation(contact)) {
      throw new ContactPrivacyError(
        400,
        "INVALID_CONFIRMATION",
        "A confirmação não corresponde ao contato selecionado.",
      );
    }

    const interactions = await transaction.dmLog.count({
      where: {
        workspaceId: input.workspaceId,
        instagramAccountId: contact.instagramAccountId,
        commenterId: contact.instagramScopedId,
        instagramAccount: { workspaceId: input.workspaceId },
        automation: {
          workspaceId: input.workspaceId,
          instagramAccountId: contact.instagramAccountId,
        },
      },
    });

    // Raw webhook envelopes cannot safely be split because Meta may batch
    // multiple changes. Delete only workspace-scoped envelopes that contain
    // the exact external identity; never use substring matching.
    const webhookEventsRemoved = await transaction.$executeRaw(Prisma.sql`
      DELETE FROM "WebhookEvent" AS event
      WHERE event."workspaceId" = ${input.workspaceId}
        AND jsonb_path_exists(
          event."payload"::jsonb,
          '$.** ? (@ == $identity)',
          jsonb_build_object('identity', to_jsonb(${contact.instagramScopedId}::text))
        )
    `);

    const interactionsAnonymized = await transaction.$executeRaw(Prisma.sql`
      UPDATE "DmLog" AS log
      SET
        "commenterId" = ${tombstoneId},
        "commenterName" = NULL,
        "commentText" = ${REMOVED_CONTENT},
        "matchedKeyword" = NULL,
        "errorMessage" = NULL,
        "sourceEventId" = NULL,
        "sourceMediaId" = NULL,
        "originalMediaId" = NULL,
        "source" = NULL,
        "publicReplyError" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      FROM "Automation" AS automation, "InstagramAccount" AS account
      WHERE log."workspaceId" = ${input.workspaceId}
        AND log."instagramAccountId" = ${contact.instagramAccountId}
        AND log."commenterId" = ${contact.instagramScopedId}
        AND automation."id" = log."automationId"
        AND automation."workspaceId" = ${input.workspaceId}
        AND automation."instagramAccountId" = ${contact.instagramAccountId}
        AND account."id" = log."instagramAccountId"
        AND account."workspaceId" = ${input.workspaceId}
    `);

    const removed = await transaction.contact.deleteMany({
      where: {
        ...scopedContactWhere(input.workspaceId, input.contactId),
        version: input.version,
      },
    });
    if (removed.count !== 1) {
      throw new ContactPrivacyError(
        409,
        "CONTACT_VERSION_CONFLICT",
        "Este contato foi atualizado por outra pessoa. Recarregue os dados antes de continuar.",
      );
    }

    await transaction.auditEvent.create({
      data: createAuditEventData({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.contactDataAnonymized,
        targetType: "Contact",
        targetId: input.contactId,
        metadata: {
          interactionsAnonymized: interactions,
          webhookEventsRemoved,
          conversationsRemoved: contact._count.conversations,
          aggregateDeliveryMetricsRetained: true,
          technicalDeduplicationIdsRetained: true,
        },
      }),
    });

    return {
      interactionsAnonymized,
      webhookEventsRemoved,
      conversationsRemoved: contact._count.conversations,
    };
  }, { isolationLevel: "Serializable" });
}
