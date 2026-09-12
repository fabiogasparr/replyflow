import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  getWorkspaceQueueSnapshot,
  unavailableQueueSnapshot,
} from "@/lib/ops/queue-observability";
import { getWorkerAlerts, getWorkerHealth } from "@/lib/ops/worker-health";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const runtime = "nodejs";

async function settled<T>(operation: Promise<T>) {
  try {
    return { ok: true as const, value: await operation };
  } catch {
    return { ok: false as const, value: null };
  }
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  const workspaceId = context.workspaceId;

  const [
    queueResult,
    workerResult,
    alertsResult,
    webhookFailures,
    dmFailures,
    tokenRefreshFailures,
    operationalEvents,
  ] = await Promise.all([
    settled(getWorkspaceQueueSnapshot(workspaceId)),
    settled(getWorkerHealth()),
    settled(getWorkerAlerts(workspaceId, 10)),
    prisma.webhookEvent.findMany({
      where: { workspaceId, status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        object: true,
        errorMessage: true,
        createdAt: true,
        processedAt: true,
      },
    }),
    prisma.dmLog.findMany({
      where: {
        workspaceId,
        status: {
          in: [
            "FAILED",
            "SKIPPED_RATE_LIMIT",
            "SKIPPED_PLAN_LIMIT",
            "SKIPPED_NO_MATCH",
            "SKIPPED_HUMAN_REVIEW",
          ],
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        commentId: true,
        commentText: true,
        errorMessage: true,
        updatedAt: true,
        automation: { select: { name: true } },
      },
    }),
    prisma.operationalEvent.findMany({
      where: { workspaceId, source: "TOKEN_REFRESH", level: "ERROR" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        message: true,
        createdAt: true,
      },
    }),
    prisma.operationalEvent.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        source: true,
        level: true,
        message: true,
        createdAt: true,
        resolvedAt: true,
      },
    }),
  ]);

  const redisAvailable = queueResult.ok && workerResult.ok && alertsResult.ok;
  const queue = queueResult.ok
    ? queueResult.value
    : unavailableQueueSnapshot();
  const workerHealth = workerResult.ok
    ? workerResult.value
    : { healthy: false, heartbeat: null, ageMs: null };

  return NextResponse.json({
    success: true,
    data: {
      services: {
        database: { available: true },
        redis: { available: redisAvailable },
        worker: { available: workerHealth.healthy },
      },
      queue,
      queueCounts: queue.counts,
      workerHealth,
      workerAlerts: alertsResult.ok ? alertsResult.value : [],
      webhookFailures,
      dmFailures,
      tokenRefreshFailures,
      operationalEvents,
    },
  });
}
