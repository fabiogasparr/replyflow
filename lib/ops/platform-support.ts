import type { DmStatus, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getDmRetryEligibility } from "@/lib/dm-retry";
import { getWorkerHealth } from "@/lib/ops/worker-health";

export const PLATFORM_SUPPORT_STATUSES = [
  "FAILED",
  "SKIPPED_RATE_LIMIT",
  "SKIPPED_PLAN_LIMIT",
] as const satisfies readonly DmStatus[];

export type PlatformSupportStatus =
  | "ALL"
  | (typeof PLATFORM_SUPPORT_STATUSES)[number];

export type PlatformSupportFilters = {
  q?: string;
  status: PlatformSupportStatus;
  cursor?: string;
  limit: number;
};

function candidateWhere({
  q,
  status,
}: Pick<PlatformSupportFilters, "q" | "status">): Prisma.DmLogWhereInput {
  return {
    status:
      status === "ALL"
        ? { in: [...PLATFORM_SUPPORT_STATUSES] }
        : status,
    workspace: { archivedAt: null },
    ...(q
      ? {
          OR: [
            { workspace: { name: { contains: q, mode: "insensitive" } } },
            { automation: { name: { contains: q, mode: "insensitive" } } },
            {
              instagramAccount: {
                username: { contains: q, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };
}

async function supportReadiness() {
  try {
    const worker = await getWorkerHealth();
    return {
      queueAvailable: true,
      workerHealthy: worker.healthy,
      workerAgeMs: worker.ageMs,
      lastSeenAt: worker.heartbeat?.checkedAt ?? null,
    };
  } catch {
    return {
      queueAvailable: false,
      workerHealthy: false,
      workerAgeMs: null,
      lastSeenAt: null,
    };
  }
}

function failureLabel(status: (typeof PLATFORM_SUPPORT_STATUSES)[number]) {
  if (status === "FAILED") return "Falha antes da confirmação";
  if (status === "SKIPPED_RATE_LIMIT") return "Limite temporário da Meta";
  return "Limite do plano";
}

export async function getPlatformSupportQueue(
  filters: PlatformSupportFilters,
  now = new Date()
) {
  const where = candidateWhere(filters);

  if (filters.cursor) {
    const validCursor = await prisma.dmLog.findFirst({
      where: { ...where, id: filters.cursor },
      select: { id: true },
    });
    if (!validCursor) {
      throw new Error("INVALID_CURSOR");
    }
  }

  const [rows, total, readiness] = await Promise.all([
    prisma.dmLog.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      ...(filters.cursor
        ? { cursor: { id: filters.cursor }, skip: 1 }
        : {}),
      take: filters.limit + 1,
      include: {
        workspace: { select: { id: true, name: true, archivedAt: true } },
        automation: {
          select: { id: true, name: true, isActive: true, workspaceId: true },
        },
        instagramAccount: {
          select: {
            id: true,
            username: true,
            instagramId: true,
            tokenExpiresAt: true,
            workspaceId: true,
          },
        },
      },
    }),
    prisma.dmLog.count({ where }),
    supportReadiness(),
  ]);

  // A corrupted cross-workspace relation must never become an operator action.
  const consistentRows = rows.filter(
    (row) =>
      row.automation.workspaceId === row.workspaceId &&
      row.instagramAccount.workspaceId === row.workspaceId &&
      row.workspace.id === row.workspaceId
  );
  const hasMore = consistentRows.length > filters.limit;
  const pageRows = hasMore
    ? consistentRows.slice(0, filters.limit)
    : consistentRows;
  const incidents = pageRows.map((row) => {
    const retry = getDmRetryEligibility(row, now);
    return {
      id: row.id,
      workspace: { id: row.workspace.id, name: row.workspace.name },
      automation: { id: row.automation.id, name: row.automation.name },
      instagramAccount: {
        id: row.instagramAccount.id,
        username: row.instagramAccount.username,
      },
      status: row.status as (typeof PLATFORM_SUPPORT_STATUSES)[number],
      failureLabel: failureLabel(
        row.status as (typeof PLATFORM_SUPPORT_STATUSES)[number]
      ),
      triggerType: row.triggerType,
      deliveryState: row.deliveryAttemptedAt
        ? ("AMBIGUOUS" as const)
        : ("NOT_ATTEMPTED" as const),
      retry,
      manualRetryCount: row.manualRetryCount,
      lastManualRetryAt: row.lastManualRetryAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  return {
    generatedAt: now,
    readiness,
    summary: {
      total,
      retryableOnPage: incidents.filter((incident) => incident.retry.allowed)
        .length,
      blockedOnPage: incidents.filter((incident) => !incident.retry.allowed)
        .length,
    },
    incidents,
    nextCursor: hasMore ? pageRows.at(-1)?.id ?? null : null,
  };
}

export type PlatformSupportQueue = Awaited<
  ReturnType<typeof getPlatformSupportQueue>
>;
