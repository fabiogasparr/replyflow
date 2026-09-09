import type { AuditAction } from "@/lib/audit";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import { prisma } from "@/lib/db/client";
import { buildDmRetryJob, getDmRetryEligibility } from "@/lib/dm-retry";
import { getDMQueue } from "@/lib/queue/client";

export type DmRetryRequestSource = "WORKSPACE" | "PLATFORM_SUPPORT";

export class DmRetryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function auditActionFor(source: DmRetryRequestSource): AuditAction {
  return source === "PLATFORM_SUPPORT"
    ? AUDIT_ACTIONS.supportDmRetryRequested
    : AUDIT_ACTIONS.dmRetryRequested;
}

export async function requestDmRetry({
  workspaceId,
  actorUserId,
  logId,
  source,
  now = new Date(),
}: {
  workspaceId: string;
  actorUserId: string;
  logId: string;
  source: DmRetryRequestSource;
  now?: Date;
}) {
  const log = await prisma.dmLog.findFirst({
    where: {
      id: logId,
      workspaceId,
      workspace: { id: workspaceId, archivedAt: null },
      automation: { workspaceId },
      instagramAccount: { workspaceId },
    },
    include: {
      workspace: { select: { archivedAt: true } },
      automation: { select: { isActive: true } },
      instagramAccount: {
        select: { instagramId: true, tokenExpiresAt: true },
      },
    },
  });
  if (!log) {
    throw new DmRetryRequestError("Envio não encontrado", 404);
  }

  const eligibility = getDmRetryEligibility(log, now);
  if (!eligibility.allowed) {
    throw new DmRetryRequestError(eligibility.reason, 409);
  }

  const previous = {
    status: log.status,
    manualRetryCount: log.manualRetryCount,
    lastManualRetryAt: log.lastManualRetryAt,
  };
  const nextRetryCount = previous.manualRetryCount + 1;
  const reserved = await prisma.dmLog.updateMany({
    where: {
      id: log.id,
      workspaceId,
      status: previous.status,
      manualRetryCount: previous.manualRetryCount,
      lastManualRetryAt: previous.lastManualRetryAt,
      deliveryAttemptedAt: null,
    },
    data: {
      status: "PENDING",
      manualRetryCount: { increment: 1 },
      lastManualRetryAt: now,
    },
  });
  if (reserved.count === 0) {
    throw new DmRetryRequestError(
      "Este envio foi atualizado por outro processo. Recarregue a página.",
      409
    );
  }

  const retryJob = buildDmRetryJob(log);
  try {
    await getDMQueue().add(retryJob.name, retryJob.data, {
      jobId: `manual_retry_${log.id}_${nextRetryCount}`,
    });
  } catch (error) {
    await prisma.dmLog.updateMany({
      where: {
        id: log.id,
        workspaceId,
        status: "PENDING",
        manualRetryCount: nextRetryCount,
        lastManualRetryAt: now,
        deliveryAttemptedAt: null,
      },
      data: {
        status: previous.status,
        manualRetryCount: previous.manualRetryCount,
        lastManualRetryAt: previous.lastManualRetryAt,
      },
    });
    console.error("[DM Retry] Failed to enqueue manual retry:", error);
    throw new DmRetryRequestError(
      "A fila está indisponível. O envio não foi alterado; tente novamente.",
      503
    );
  }

  // Queue delivery is the primary outcome. Returning an error after enqueueing
  // would invite a second click and a duplicate support request.
  await prisma.auditEvent
    .create({
      data: createAuditEventData({
        workspaceId,
        actorUserId,
        action: auditActionFor(source),
        targetType: "DmLog",
        targetId: log.id,
        metadata: {
          triggerType: log.triggerType,
          retryNumber: nextRetryCount,
          requestedVia: source,
        },
      }),
    })
    .catch((error) => {
      console.error("[DM Retry] Failed to write audit event:", error);
    });

  return {
    id: log.id,
    status: "PENDING" as const,
    manualRetryCount: nextRetryCount,
    lastManualRetryAt: now,
  };
}
