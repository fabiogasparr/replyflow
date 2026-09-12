import { prisma } from "@/lib/db/client";
import { getEmailAuthReadiness } from "@/lib/auth-readiness";
import {
  getPlatformQueueSnapshot,
  unavailableQueueSnapshot,
  type WorkspaceQueueSnapshot,
} from "@/lib/ops/queue-observability";
import { getWorkerHealth } from "@/lib/ops/worker-health";

export type PlatformObservationPeriod = "1h" | "24h" | "7d";
export type PlatformHealthStatus = "HEALTHY" | "DEGRADED" | "CRITICAL";

type CountGroup = { _count: { _all: number } };

export type FailureComparison = {
  current: { total: number; issues: number; rate: number };
  previous: { total: number; issues: number; rate: number };
  trend: "UP" | "DOWN" | "STABLE";
  anomaly: boolean;
  severity: "NONE" | "WARNING" | "CRITICAL";
};

const PERIOD_MS: Record<PlatformObservationPeriod, number> = {
  "1h": 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
};

const WEBHOOK_STATUSES = ["PENDING", "PROCESSED", "FAILED"] as const;
const DM_STATUSES = [
  "PENDING",
  "SENT",
  "FAILED",
  "SKIPPED_DEDUP",
  "SKIPPED_RATE_LIMIT",
  "SKIPPED_PLAN_LIMIT",
  "SKIPPED_NO_MATCH",
  "SKIPPED_HUMAN_REVIEW",
] as const;
const OPERATIONAL_SOURCES = ["WORKER", "TOKEN_REFRESH", "HEALTH", "SYSTEM"] as const;
const OPERATIONAL_LEVELS = ["INFO", "WARNING", "ERROR"] as const;
const BILLING_STATUSES = ["PENDING", "PROCESSED", "FAILED", "IGNORED"] as const;

function sumGroups<T extends CountGroup>(groups: T[], matches: (group: T) => boolean) {
  return groups.reduce(
    (total, group) => total + (matches(group) ? group._count._all : 0),
    0
  );
}

function normalizedCounts<
  Key extends string,
  Group extends CountGroup,
>(keys: readonly Key[], groups: Group[], keyOf: (group: Group) => string) {
  return Object.fromEntries(
    keys.map((key) => [key, sumGroups(groups, (group) => keyOf(group) === key)])
  ) as Record<Key, number>;
}

export function compareFailureRates<T extends CountGroup>(
  currentGroups: T[],
  previousGroups: T[],
  isIssue: (group: T) => boolean
): FailureComparison {
  const currentTotal = sumGroups(currentGroups, () => true);
  const currentIssues = sumGroups(currentGroups, isIssue);
  const previousTotal = sumGroups(previousGroups, () => true);
  const previousIssues = sumGroups(previousGroups, isIssue);
  const currentRate = currentTotal === 0 ? 0 : currentIssues / currentTotal;
  const previousRate = previousTotal === 0 ? 0 : previousIssues / previousTotal;
  const delta = currentRate - previousRate;
  const trend = Math.abs(delta) < 0.01 ? "STABLE" : delta > 0 ? "UP" : "DOWN";
  const anomaly =
    currentIssues >= 3 &&
    currentRate >= 0.05 &&
    (previousTotal === 0 || currentRate >= previousRate * 2 + 0.02);
  const severity = !anomaly
    ? "NONE"
    : currentIssues >= 10 && currentRate >= 0.25
      ? "CRITICAL"
      : "WARNING";

  return {
    current: {
      total: currentTotal,
      issues: currentIssues,
      rate: Math.round(currentRate * 10_000) / 100,
    },
    previous: {
      total: previousTotal,
      issues: previousIssues,
      rate: Math.round(previousRate * 10_000) / 100,
    },
    trend,
    anomaly,
    severity,
  };
}

async function settled<T>(operation: Promise<T>) {
  try {
    return { ok: true as const, value: await operation };
  } catch {
    return { ok: false as const, value: null };
  }
}

function range(start: Date, end?: Date) {
  return end ? { gte: start, lt: end } : { gte: start };
}

async function readDatabaseMetrics(period: PlatformObservationPeriod, now: Date) {
  const duration = PERIOD_MS[period];
  const currentStart = new Date(now.getTime() - duration);
  const previousStart = new Date(currentStart.getTime() - duration);
  const expiringSoon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000);

  const [
    webhookCurrent,
    webhookPrevious,
    dmCurrent,
    dmPrevious,
    operationalCurrent,
    operationalPrevious,
    automationErrors,
    billingCurrent,
    expiredTokens,
    expiringTokens,
    pendingWebhooks,
    activeSessions,
    verifiedUsers,
    pendingVerificationUsers,
  ] = await Promise.all([
    prisma.webhookEvent.groupBy({
      by: ["workspaceId", "status"],
      where: { createdAt: range(currentStart) },
      _count: { _all: true },
    }),
    prisma.webhookEvent.groupBy({
      by: ["workspaceId", "status"],
      where: { createdAt: range(previousStart, currentStart) },
      _count: { _all: true },
    }),
    prisma.dmLog.groupBy({
      by: ["workspaceId", "status"],
      where: { updatedAt: range(currentStart) },
      _count: { _all: true },
    }),
    prisma.dmLog.groupBy({
      by: ["workspaceId", "status"],
      where: { updatedAt: range(previousStart, currentStart) },
      _count: { _all: true },
    }),
    prisma.operationalEvent.groupBy({
      by: ["workspaceId", "source", "level"],
      where: { createdAt: range(currentStart) },
      _count: { _all: true },
    }),
    prisma.operationalEvent.groupBy({
      by: ["workspaceId", "source", "level"],
      where: { createdAt: range(previousStart, currentStart) },
      _count: { _all: true },
    }),
    prisma.automation.groupBy({
      by: ["workspaceId", "lastErrorKind"],
      where: {
        lastErrorAt: range(currentStart),
        lastErrorKind: { in: ["AUTHENTICATION", "CONFIGURATION"] },
      },
      _count: { _all: true },
    }),
    prisma.billingEvent.groupBy({
      by: ["workspaceId", "status"],
      where: { createdAt: range(currentStart) },
      _count: { _all: true },
    }),
    prisma.instagramAccount.groupBy({
      by: ["workspaceId"],
      where: { tokenExpiresAt: { lte: now } },
      _count: { _all: true },
    }),
    prisma.instagramAccount.groupBy({
      by: ["workspaceId"],
      where: { tokenExpiresAt: { gt: now, lte: expiringSoon } },
      _count: { _all: true },
    }),
    prisma.instagramAccount.groupBy({
      by: ["workspaceId"],
      where: { webhookSubscribed: false },
      _count: { _all: true },
    }),
    prisma.session.count({ where: { expires: { gt: now } } }),
    prisma.user.count({ where: { emailVerified: { not: null } } }),
    prisma.user.count({ where: { emailVerified: null } }),
  ]);

  const webhookCounts = normalizedCounts(
    WEBHOOK_STATUSES,
    webhookCurrent,
    (group) => group.status
  );
  const deliveryCounts = normalizedCounts(
    DM_STATUSES,
    dmCurrent,
    (group) => group.status
  );
  const operationalByLevel = normalizedCounts(
    OPERATIONAL_LEVELS,
    operationalCurrent,
    (group) => group.level
  );
  const operationalBySource = normalizedCounts(
    OPERATIONAL_SOURCES,
    operationalCurrent,
    (group) => group.source
  );
  const billingCounts = normalizedCounts(
    BILLING_STATUSES,
    billingCurrent,
    (group) => group.status
  );
  const webhookComparison = compareFailureRates(
    webhookCurrent,
    webhookPrevious,
    (group) => group.status === "FAILED"
  );
  const deliveryComparison = compareFailureRates(
    dmCurrent,
    dmPrevious,
    (group) =>
      group.status === "FAILED" ||
      group.status === "SKIPPED_RATE_LIMIT" ||
      group.status === "SKIPPED_PLAN_LIMIT"
  );
  const operationalComparison = compareFailureRates(
    operationalCurrent,
    operationalPrevious,
    (group) => group.level === "ERROR"
  );

  const incidentWorkspaces = new Map<
    string,
    {
      webhookFailures: number;
      deliveryFailures: number;
      operationalErrors: number;
      authenticationErrors: number;
      billingProblems: number;
      expiredTokens: number;
      expiringTokens: number;
      pendingWebhooks: number;
      score: number;
    }
  >();
  const increment = (
    workspaceId: string | null,
    key: Exclude<keyof NonNullable<ReturnType<typeof incidentWorkspaces.get>>, "score">,
    count: number,
    weight: number
  ) => {
    if (!workspaceId || count <= 0) return;
    const current = incidentWorkspaces.get(workspaceId) ?? {
      webhookFailures: 0,
      deliveryFailures: 0,
      operationalErrors: 0,
      authenticationErrors: 0,
      billingProblems: 0,
      expiredTokens: 0,
      expiringTokens: 0,
      pendingWebhooks: 0,
      score: 0,
    };
    current[key] += count;
    current.score += count * weight;
    incidentWorkspaces.set(workspaceId, current);
  };

  webhookCurrent.forEach((group) => {
    if (group.status === "FAILED") {
      increment(group.workspaceId, "webhookFailures", group._count._all, 3);
    }
  });
  dmCurrent.forEach((group) => {
    if (["FAILED", "SKIPPED_RATE_LIMIT", "SKIPPED_PLAN_LIMIT"].includes(group.status)) {
      increment(group.workspaceId, "deliveryFailures", group._count._all, 2);
    }
  });
  operationalCurrent.forEach((group) => {
    if (group.level === "ERROR") {
      increment(group.workspaceId, "operationalErrors", group._count._all, 3);
    }
  });
  automationErrors.forEach((group) =>
    increment(group.workspaceId, "authenticationErrors", group._count._all, 4)
  );
  billingCurrent.forEach((group) => {
    if (group.status === "FAILED" || group.status === "PENDING") {
      increment(group.workspaceId, "billingProblems", group._count._all, 3);
    }
  });
  expiredTokens.forEach((group) =>
    increment(group.workspaceId, "expiredTokens", group._count._all, 5)
  );
  expiringTokens.forEach((group) =>
    increment(group.workspaceId, "expiringTokens", group._count._all, 1)
  );
  pendingWebhooks.forEach((group) =>
    increment(group.workspaceId, "pendingWebhooks", group._count._all, 2)
  );

  const rankedIds = [...incidentWorkspaces.entries()]
    .sort(
      ([leftId, left], [rightId, right]) =>
        right.score - left.score || leftId.localeCompare(rightId)
    )
    .slice(0, 10)
    .map(([workspaceId]) => workspaceId);
  const workspaceNames = rankedIds.length
    ? await prisma.workspace.findMany({
        where: { id: { in: rankedIds } },
        select: { id: true, name: true, archivedAt: true },
      })
    : [];
  const namesById = new Map(workspaceNames.map((workspace) => [workspace.id, workspace]));

  return {
    period: { code: period, currentStart, previousStart, end: now },
    webhooks: { counts: webhookCounts, comparison: webhookComparison },
    deliveries: { counts: deliveryCounts, comparison: deliveryComparison },
    operationalEvents: {
      byLevel: operationalByLevel,
      bySource: operationalBySource,
      comparison: operationalComparison,
    },
    automations: {
      authenticationErrors: sumGroups(
        automationErrors,
        (group) => group.lastErrorKind === "AUTHENTICATION"
      ),
      configurationErrors: sumGroups(
        automationErrors,
        (group) => group.lastErrorKind === "CONFIGURATION"
      ),
    },
    billing: { counts: billingCounts },
    integrations: {
      expiredTokens: sumGroups(expiredTokens, () => true),
      expiringTokens: sumGroups(expiringTokens, () => true),
      pendingWebhooks: sumGroups(pendingWebhooks, () => true),
    },
    authentication: {
      activeSessions,
      verifiedUsers,
      pendingVerificationUsers,
    },
    incidentWorkspaces: rankedIds.map((workspaceId) => ({
      workspaceId,
      name: namesById.get(workspaceId)?.name ?? "Workspace indisponível",
      archived: Boolean(namesById.get(workspaceId)?.archivedAt),
      ...incidentWorkspaces.get(workspaceId)!,
    })),
  };
}

export async function getPlatformOperationsSnapshot(
  period: PlatformObservationPeriod,
  now = new Date()
) {
  const emailReadiness = getEmailAuthReadiness();
  const [queueResult, workerResult, databaseResult] = await Promise.all([
    settled(getPlatformQueueSnapshot()),
    settled(getWorkerHealth()),
    settled(readDatabaseMetrics(period, now)),
  ]);
  const queue: WorkspaceQueueSnapshot = queueResult.ok
    ? queueResult.value
    : unavailableQueueSnapshot(now);
  const worker = workerResult.ok
    ? {
        healthy: workerResult.value.healthy,
        ageMs: workerResult.value.ageMs,
        lastSeenAt: workerResult.value.heartbeat?.checkedAt ?? null,
        startedAt: workerResult.value.heartbeat?.startedAt ?? null,
      }
    : { healthy: false, ageMs: null, lastSeenAt: null, startedAt: null };
  const issues: Array<{
    code: string;
    severity: "WARNING" | "CRITICAL";
    message: string;
  }> = [];
  const addIssue = (
    condition: boolean,
    code: string,
    severity: "WARNING" | "CRITICAL",
    message: string
  ) => {
    if (condition) issues.push({ code, severity, message });
  };

  addIssue(!databaseResult.ok, "DATABASE_UNAVAILABLE", "CRITICAL", "As métricas do banco estão indisponíveis.");
  addIssue(!queueResult.ok || !workerResult.ok, "REDIS_UNAVAILABLE", "CRITICAL", "Redis ou a fila estão indisponíveis.");
  addIssue(!worker.healthy, "WORKER_OFFLINE", "CRITICAL", "O worker de DMs não possui heartbeat recente.");
  addIssue(queue.status === "CRITICAL", "QUEUE_CRITICAL", "CRITICAL", "A fila possui processamento com atraso crítico.");
  addIssue(queue.status === "DEGRADED", "QUEUE_DEGRADED", "WARNING", "A fila possui atraso ou jobs falhos.");
  addIssue(!emailReadiness.ready, "EMAIL_AUTH_NOT_READY", "WARNING", "O envio de links de acesso não está pronto.");

  if (databaseResult.ok) {
    const metrics = databaseResult.value;
    addIssue(metrics.integrations.expiredTokens > 0, "TOKENS_EXPIRED", "WARNING", `${metrics.integrations.expiredTokens} conta(s) possuem token vencido.`);
    addIssue(metrics.integrations.pendingWebhooks > 0, "WEBHOOK_SUBSCRIPTION_PENDING", "WARNING", `${metrics.integrations.pendingWebhooks} conta(s) aguardam inscrição de webhook.`);
    addIssue(metrics.webhooks.comparison.anomaly, "WEBHOOK_FAILURE_ANOMALY", metrics.webhooks.comparison.severity === "CRITICAL" ? "CRITICAL" : "WARNING", "Falhas de webhook estão acima do período anterior.");
    addIssue(!metrics.webhooks.comparison.anomaly && metrics.webhooks.counts.FAILED > 0, "WEBHOOK_FAILURES", "WARNING", `${metrics.webhooks.counts.FAILED} webhook(s) falharam no período.`);
    addIssue(metrics.deliveries.comparison.anomaly, "DELIVERY_FAILURE_ANOMALY", metrics.deliveries.comparison.severity === "CRITICAL" ? "CRITICAL" : "WARNING", "Falhas ou bloqueios de entrega estão acima do período anterior.");
    addIssue(!metrics.deliveries.comparison.anomaly && metrics.deliveries.comparison.current.issues > 0, "DELIVERY_FAILURES", "WARNING", `${metrics.deliveries.comparison.current.issues} entrega(s) falharam ou foram bloqueadas.`);
    addIssue(metrics.operationalEvents.comparison.anomaly, "OPERATIONAL_ERROR_ANOMALY", metrics.operationalEvents.comparison.severity === "CRITICAL" ? "CRITICAL" : "WARNING", "Erros operacionais estão acima do período anterior.");
    addIssue(!metrics.operationalEvents.comparison.anomaly && metrics.operationalEvents.byLevel.ERROR > 0, "OPERATIONAL_ERRORS", "WARNING", `${metrics.operationalEvents.byLevel.ERROR} erro(s) operacionais ocorreram no período.`);
    addIssue(metrics.automations.authenticationErrors > 0, "AUTOMATION_AUTHENTICATION_ERRORS", "WARNING", `${metrics.automations.authenticationErrors} automação(ões) apresentam erro de autenticação.`);
    addIssue(metrics.billing.counts.FAILED > 0, "BILLING_EVENTS_FAILED", "WARNING", `${metrics.billing.counts.FAILED} evento(s) de cobrança falharam.`);
  }

  const status: PlatformHealthStatus = issues.some(
    (issue) => issue.severity === "CRITICAL"
  )
    ? "CRITICAL"
    : issues.length > 0
      ? "DEGRADED"
      : "HEALTHY";

  return {
    generatedAt: now,
    status,
    services: {
      database: { available: databaseResult.ok },
      redis: { available: queueResult.ok && workerResult.ok },
      worker,
      queue,
      emailAuthentication: {
        ready: emailReadiness.ready,
        provider: emailReadiness.provider,
      },
    },
    metrics: databaseResult.value,
    issues,
  };
}
