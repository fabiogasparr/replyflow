import { NextRequest, NextResponse } from "next/server";
import type { DmStatus } from "@/app/generated/prisma/client";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import { prisma } from "@/lib/db/client";
import {
  buildDmRetryJob,
  getDmRetryEligibility,
} from "@/lib/dm-retry";
import { getDMQueue } from "@/lib/queue/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { canManageAutomations } from "@/lib/workspace-permissions";

type RetryRouteContext = { params: Promise<{ id: string }> };

export async function POST(
  _request: NextRequest,
  route: RetryRouteContext
) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  if (!canManageAutomations(context.role)) {
    return NextResponse.json(
      {
        success: false,
        error: "Seu perfil pode consultar os envios, mas não pode reprocessá-los",
      },
      { status: 403 }
    );
  }

  const { id } = await route.params;
  const log = await prisma.dmLog.findFirst({
    where: {
      id,
      workspaceId: context.workspaceId,
      automation: { workspaceId: context.workspaceId },
      instagramAccount: { workspaceId: context.workspaceId },
    },
    include: {
      automation: { select: { isActive: true } },
      instagramAccount: { select: { instagramId: true } },
    },
  });
  if (!log) {
    return NextResponse.json(
      { success: false, error: "Envio não encontrado" },
      { status: 404 }
    );
  }

  const now = new Date();
  const eligibility = getDmRetryEligibility(log, now);
  if (!eligibility.allowed) {
    return NextResponse.json(
      { success: false, error: eligibility.reason },
      { status: 409 }
    );
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
      workspaceId: context.workspaceId,
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
    return NextResponse.json(
      {
        success: false,
        error: "Este envio foi atualizado por outro processo. Recarregue a página.",
      },
      { status: 409 }
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
        workspaceId: context.workspaceId,
        status: "PENDING",
        manualRetryCount: nextRetryCount,
        lastManualRetryAt: now,
        deliveryAttemptedAt: null,
      },
      data: {
        status: previous.status as DmStatus,
        manualRetryCount: previous.manualRetryCount,
        lastManualRetryAt: previous.lastManualRetryAt,
      },
    });
    console.error("[DM Retry] Failed to enqueue manual retry:", error);
    return NextResponse.json(
      {
        success: false,
        error: "A fila está indisponível. O envio não foi alterado; tente novamente.",
      },
      { status: 503 }
    );
  }

  // Queue delivery is the primary outcome. If the audit store has a transient
  // failure, returning an error would invite a second click and duplicate job.
  await prisma.auditEvent
    .create({
      data: createAuditEventData({
        workspaceId: context.workspaceId,
        actorUserId: context.userId,
        action: AUDIT_ACTIONS.dmRetryRequested,
        targetType: "DmLog",
        targetId: log.id,
        metadata: {
          triggerType: log.triggerType,
          retryNumber: nextRetryCount,
        },
      }),
    })
    .catch((error) => {
      console.error("[DM Retry] Failed to write audit event:", error);
    });

  return NextResponse.json(
    {
      success: true,
      data: {
        id: log.id,
        status: "PENDING",
        manualRetryCount: nextRetryCount,
        lastManualRetryAt: now,
      },
    },
    { status: 202 }
  );
}
