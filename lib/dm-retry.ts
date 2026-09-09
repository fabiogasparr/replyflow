import type {
  DmStatus,
  DmTriggerType,
} from "@/app/generated/prisma/client";
import {
  MESSAGE_JOB_NAME,
  type ProcessCommentJob,
  type ProcessMessageJob,
} from "@/lib/queue/client";

export const DM_RETRY_COOLDOWN_MS = 60_000;

export type DmRetryCandidate = {
  id: string;
  automationId: string;
  commenterId: string;
  commenterName: string | null;
  commentId: string;
  commentText: string;
  matchedKeyword: string | null;
  status: DmStatus;
  triggerType: DmTriggerType;
  sourceEventId: string | null;
  sourceMediaId: string | null;
  originalMediaId: string | null;
  deliveryAttemptedAt: Date | null;
  manualRetryCount: number;
  lastManualRetryAt: Date | null;
  automation: { isActive: boolean };
  instagramAccount: { instagramId: string; tokenExpiresAt?: Date | null };
  workspace?: { archivedAt: Date | null };
};

export type DmRetryEligibility =
  | { allowed: true; reason: null }
  | { allowed: false; reason: string };

const RETRYABLE_STATUSES = new Set<DmStatus>([
  "FAILED",
  "SKIPPED_RATE_LIMIT",
  "SKIPPED_PLAN_LIMIT",
]);

export function getDmRetryEligibility(
  log: DmRetryCandidate,
  now = new Date()
): DmRetryEligibility {
  if (log.workspace?.archivedAt) {
    return {
      allowed: false,
      reason: "A empresa está arquivada e não pode processar novos envios.",
    };
  }
  if (!RETRYABLE_STATUSES.has(log.status)) {
    return {
      allowed: false,
      reason:
        log.status === "PENDING"
          ? "Este envio já está aguardando processamento."
          : "Este status não permite reprocessamento.",
    };
  }
  if (!log.automation.isActive) {
    return {
      allowed: false,
      reason: "Ative a automação antes de reprocessar este envio.",
    };
  }
  if (log.deliveryAttemptedAt) {
    return {
      allowed: false,
      reason:
        "A entrega já foi iniciada na Meta. O reenvio foi bloqueado para evitar uma mensagem duplicada.",
    };
  }
  if (
    log.instagramAccount.tokenExpiresAt &&
    log.instagramAccount.tokenExpiresAt.getTime() <= now.getTime()
  ) {
    return {
      allowed: false,
      reason: "Reconecte a conta do Instagram antes de reprocessar este envio.",
    };
  }
  if (
    log.lastManualRetryAt &&
    now.getTime() - log.lastManualRetryAt.getTime() < DM_RETRY_COOLDOWN_MS
  ) {
    return {
      allowed: false,
      reason: "Aguarde um minuto antes de solicitar outro reprocessamento.",
    };
  }
  if (log.triggerType === "POSTBACK") {
    return {
      allowed: false,
      reason: "Interações de botão não podem ser recriadas manualmente.",
    };
  }
  if (!log.sourceEventId) {
    return {
      allowed: false,
      reason: "O evento de origem não está disponível para este registro antigo.",
    };
  }
  if (log.triggerType === "COMMENT" && !log.sourceMediaId) {
    return {
      allowed: false,
      reason: "A publicação de origem não está disponível para este registro antigo.",
    };
  }

  return { allowed: true, reason: null };
}

export function buildDmRetryJob(log: DmRetryCandidate):
  | { name: "process-comment"; data: ProcessCommentJob }
  | { name: typeof MESSAGE_JOB_NAME; data: ProcessMessageJob } {
  if (log.triggerType === "COMMENT" && log.sourceEventId && log.sourceMediaId) {
    return {
      name: "process-comment",
      data: {
        automationId: log.automationId,
        instagramAccountId: log.instagramAccount.instagramId,
        commentId: log.sourceEventId,
        commentText: log.commentText,
        commenterId: log.commenterId,
        matchedKeyword: log.matchedKeyword,
        ...(log.commenterName ? { commenterName: log.commenterName } : {}),
        mediaId: log.sourceMediaId,
        ...(log.originalMediaId
          ? { originalMediaId: log.originalMediaId }
          : {}),
        source: "MANUAL",
      },
    };
  }
  if (log.triggerType === "MESSAGE" && log.sourceEventId) {
    return {
      name: MESSAGE_JOB_NAME,
      data: {
        automationId: log.automationId,
        instagramAccountId: log.instagramAccount.instagramId,
        messageId: log.sourceEventId,
        messageText: log.commentText,
        senderId: log.commenterId,
        matchedKeyword: log.matchedKeyword,
      },
    };
  }

  throw new Error("DM log does not contain a replayable source event");
}
