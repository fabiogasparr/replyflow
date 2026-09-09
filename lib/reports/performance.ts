import { Prisma } from "@/app/generated/prisma/client";
import type { WorkspaceRole } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  calculateCtr,
  normalizeTopKeywords,
  summarizeDmStatuses,
} from "@/lib/tracking/analytics";
import { hasWorkspacePermission } from "@/lib/workspace-permissions";

export type ReportPreset = "7d" | "30d" | "90d" | "custom";

export type PerformanceReportFilters = {
  preset: ReportPreset;
  from?: string;
  to?: string;
  instagramAccountId?: string;
  automationId?: string;
};

type CountRow = { _count: { _all: number } };
type DailyMetricRow = {
  day: string;
  metric: "SENT" | "CLICK";
  count: number | bigint;
};

const BRAZIL_TIME_ZONE = "America/Sao_Paulo";
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CUSTOM_DAYS = 366;

export class PerformanceReportError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

function brazilDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BRAZIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isValidDateKey(value: string) {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function startOfBrazilDay(dateKey: string) {
  // Brazil has used UTC-03 without daylight saving time since 2019. Report
  // filters are intentionally capped at 366 days, so this offset is stable.
  return new Date(`${dateKey}T00:00:00-03:00`);
}

export function resolvePerformancePeriod(
  filters: Pick<PerformanceReportFilters, "preset" | "from" | "to">,
  now = new Date()
) {
  const to = filters.preset === "custom" ? filters.to : brazilDateKey(now);
  const presetDays =
    filters.preset === "7d" ? 7 : filters.preset === "30d" ? 30 : 90;
  const from =
    filters.preset === "custom"
      ? filters.from
      : to
        ? addDays(to, -(presetDays - 1))
        : undefined;

  if (!from || !to || !isValidDateKey(from) || !isValidDateKey(to)) {
    throw new PerformanceReportError("Informe um período válido");
  }
  if (from > to) {
    throw new PerformanceReportError("A data inicial deve ser anterior à data final");
  }

  const start = startOfBrazilDay(from);
  const endExclusive = startOfBrazilDay(addDays(to, 1));
  const dayCount = Math.round(
    (endExclusive.getTime() - start.getTime()) / (24 * 60 * 60 * 1_000)
  );
  if (dayCount > MAX_CUSTOM_DAYS) {
    throw new PerformanceReportError(
      `O relatório aceita no máximo ${MAX_CUSTOM_DAYS} dias`
    );
  }
  const previousStart = new Date(
    start.getTime() - (endExclusive.getTime() - start.getTime())
  );

  return {
    preset: filters.preset,
    from,
    to,
    dayCount,
    timeZone: BRAZIL_TIME_ZONE,
    start,
    endExclusive,
    previousStart,
    previousEndExclusive: start,
  };
}

function sumGroups<T extends CountRow>(rows: T[]) {
  return rows.reduce((total, row) => total + row._count._all, 0);
}

function percentageChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1_000) / 10;
}

function deliveryRate(sent: number, failed: number) {
  const attempted = sent + failed;
  return attempted === 0
    ? 0
    : Math.round((sent / attempted) * 1_000) / 10;
}

function escapeCsvCell(value: string | number) {
  let normalized = String(value);
  if (/^[=+\-@]/.test(normalized)) normalized = `'${normalized}`;
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function buildPerformanceCsv(report: Awaited<ReturnType<typeof getWorkspacePerformanceReport>>) {
  const header = [
    "Campanha",
    "Conta do Instagram",
    "Enviadas",
    "Ignoradas",
    "Falhas",
    "Cliques",
    "CTR (%)",
    "Taxa de entrega (%)",
  ];
  const rows = report.campaigns.map((campaign) => [
    campaign.name,
    `@${campaign.instagramUsername}`,
    campaign.sent,
    campaign.skipped,
    campaign.failed,
    campaign.clicks,
    campaign.ctr.toLocaleString("pt-BR"),
    campaign.deliveryRate.toLocaleString("pt-BR"),
  ]);
  return `\uFEFF${[header, ...rows]
    .map((row) => row.map(escapeCsvCell).join(";"))
    .join("\r\n")}\r\n`;
}

export async function getWorkspacePerformanceReport({
  workspaceId,
  role,
  filters,
  now = new Date(),
}: {
  workspaceId: string;
  role: WorkspaceRole;
  filters: PerformanceReportFilters;
  now?: Date;
}) {
  if (!hasWorkspacePermission(role, "reports:view")) {
    throw new PerformanceReportError(
      "Seu perfil não pode visualizar relatórios",
      403
    );
  }

  const period = resolvePerformancePeriod(filters, now);
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
    select: { id: true, username: true },
  });
  if (
    filters.instagramAccountId &&
    !accounts.some((account) => account.id === filters.instagramAccountId)
  ) {
    throw new PerformanceReportError(
      "A conta do Instagram não pertence ao espaço de trabalho atual"
    );
  }

  const availableCampaigns = await prisma.automation.findMany({
    where: {
      workspaceId,
      ...(filters.instagramAccountId
        ? { instagramAccountId: filters.instagramAccountId }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      name: true,
      isActive: true,
      instagramAccountId: true,
      instagramAccount: { select: { username: true } },
    },
  });
  if (
    filters.automationId &&
    !availableCampaigns.some(
      (automation) => automation.id === filters.automationId
    )
  ) {
    throw new PerformanceReportError(
      "A automação não pertence aos filtros do espaço de trabalho atual"
    );
  }

  const metricWhere = {
    workspaceId,
    createdAt: { gte: period.start, lt: period.endExclusive },
    ...(filters.instagramAccountId
      ? { instagramAccountId: filters.instagramAccountId }
      : {}),
    ...(filters.automationId ? { automationId: filters.automationId } : {}),
  };
  const previousWhere = {
    workspaceId,
    createdAt: {
      gte: period.previousStart,
      lt: period.previousEndExclusive,
    },
    ...(filters.instagramAccountId
      ? { instagramAccountId: filters.instagramAccountId }
      : {}),
    ...(filters.automationId ? { automationId: filters.automationId } : {}),
  };
  const accountSql = filters.instagramAccountId
    ? Prisma.sql`AND "instagramAccountId" = ${filters.instagramAccountId}`
    : Prisma.empty;
  const automationSql = filters.automationId
    ? Prisma.sql`AND "automationId" = ${filters.automationId}`
    : Prisma.empty;

  const [
    statusRows,
    clickRows,
    previousStatusRows,
    previousClickRows,
    keywordRows,
    dailyRows,
  ] = await Promise.all([
    prisma.dmLog.groupBy({
      by: ["automationId", "status"],
      where: metricWhere,
      _count: { _all: true },
    }),
    prisma.linkClick.groupBy({
      by: ["automationId"],
      where: metricWhere,
      _count: { _all: true },
    }),
    prisma.dmLog.groupBy({
      by: ["status"],
      where: previousWhere,
      _count: { _all: true },
    }),
    prisma.linkClick.groupBy({
      by: ["automationId"],
      where: previousWhere,
      _count: { _all: true },
    }),
    prisma.dmLog.groupBy({
      by: ["automationId", "matchedKeyword"],
      where: { ...metricWhere, matchedKeyword: { not: null } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<DailyMetricRow[]>(Prisma.sql`
      SELECT
        TO_CHAR(("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${BRAZIL_TIME_ZONE})::date, 'YYYY-MM-DD') AS day,
        'SENT'::text AS metric,
        COUNT(*)::int AS count
      FROM "DmLog"
      WHERE "workspaceId" = ${workspaceId}
        AND "createdAt" >= ${period.start}
        AND "createdAt" < ${period.endExclusive}
        AND "status" = 'SENT'::"DmStatus"
        ${accountSql}
        ${automationSql}
      GROUP BY 1
      UNION ALL
      SELECT
        TO_CHAR(("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${BRAZIL_TIME_ZONE})::date, 'YYYY-MM-DD') AS day,
        'CLICK'::text AS metric,
        COUNT(*)::int AS count
      FROM "LinkClick"
      WHERE "workspaceId" = ${workspaceId}
        AND "createdAt" >= ${period.start}
        AND "createdAt" < ${period.endExclusive}
        ${accountSql}
        ${automationSql}
      GROUP BY 1
      ORDER BY 1 ASC, 2 ASC
    `),
  ]);

  const statusSummary = summarizeDmStatuses(
    statusRows.map((row) => ({
      status: row.status,
      _count: row._count._all,
    }))
  );
  const previousStatusSummary = summarizeDmStatuses(
    previousStatusRows.map((row) => ({
      status: row.status,
      _count: row._count._all,
    }))
  );
  const clicks = sumGroups(clickRows);
  const previousClicks = sumGroups(previousClickRows);
  const keywordTotals = new Map<string, number>();
  for (const row of keywordRows) {
    if (!row.matchedKeyword) continue;
    keywordTotals.set(
      row.matchedKeyword,
      (keywordTotals.get(row.matchedKeyword) ?? 0) + row._count._all
    );
  }
  const topKeywords = normalizeTopKeywords(
    [...keywordTotals].map(([matchedKeyword, count]) => ({
      matchedKeyword,
      _count: count,
    })),
    8
  );

  const dailyByKey = new Map<string, { date: string; sent: number; clicks: number }>(
    Array.from({ length: period.dayCount }, (_, index) => {
      const date = addDays(period.from, index);
      return [date, { date, sent: 0, clicks: 0 }];
    })
  );
  for (const row of dailyRows) {
    const day = dailyByKey.get(row.day);
    if (!day) continue;
    const count = Number(row.count);
    if (row.metric === "SENT") day.sent += count;
    if (row.metric === "CLICK") day.clicks += count;
  }

  const campaignMetrics = new Map<
    string,
    { sent: number; skipped: number; failed: number; clicks: number }
  >();
  for (const campaign of availableCampaigns) {
    campaignMetrics.set(campaign.id, {
      sent: 0,
      skipped: 0,
      failed: 0,
      clicks: 0,
    });
  }
  for (const row of statusRows) {
    const metrics = campaignMetrics.get(row.automationId);
    if (!metrics) continue;
    if (row.status === "SENT") metrics.sent += row._count._all;
    if (row.status === "FAILED") metrics.failed += row._count._all;
    if (row.status.startsWith("SKIPPED_")) metrics.skipped += row._count._all;
  }
  for (const row of clickRows) {
    const metrics = campaignMetrics.get(row.automationId);
    if (metrics) metrics.clicks += row._count._all;
  }

  const campaigns = availableCampaigns
    .filter(
      (campaign) =>
        !filters.automationId || campaign.id === filters.automationId
    )
    .map((campaign) => {
      const metrics = campaignMetrics.get(campaign.id)!;
      return {
        id: campaign.id,
        name: campaign.name,
        isActive: campaign.isActive,
        instagramAccountId: campaign.instagramAccountId,
        instagramUsername: campaign.instagramAccount.username,
        ...metrics,
        ctr: calculateCtr(metrics.clicks, metrics.sent),
        deliveryRate: deliveryRate(metrics.sent, metrics.failed),
      };
    })
    .sort((left, right) => right.sent - left.sent || left.name.localeCompare(right.name));

  return {
    generatedAt: now,
    period: {
      preset: period.preset,
      from: period.from,
      to: period.to,
      dayCount: period.dayCount,
      timeZone: period.timeZone,
    },
    appliedFilters: {
      instagramAccountId: filters.instagramAccountId ?? null,
      automationId: filters.automationId ?? null,
    },
    options: {
      accounts,
      campaigns: availableCampaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        instagramAccountId: campaign.instagramAccountId,
        instagramUsername: campaign.instagramAccount.username,
      })),
    },
    totals: {
      sent: statusSummary.sent,
      skipped: statusSummary.skipped,
      failed: statusSummary.failed,
      clicks,
      ctr: calculateCtr(clicks, statusSummary.sent),
      deliveryRate: deliveryRate(statusSummary.sent, statusSummary.failed),
    },
    comparison: {
      sent: {
        previous: previousStatusSummary.sent,
        changePercent: percentageChange(
          statusSummary.sent,
          previousStatusSummary.sent
        ),
      },
      failed: {
        previous: previousStatusSummary.failed,
        changePercent: percentageChange(
          statusSummary.failed,
          previousStatusSummary.failed
        ),
      },
      clicks: {
        previous: previousClicks,
        changePercent: percentageChange(clicks, previousClicks),
      },
    },
    topKeywords,
    daily: [...dailyByKey.values()],
    campaigns,
    conversion: {
      available: false,
      reason:
        "Conversões de venda exigem um evento de negócio integrado; cliques não são apresentados como vendas.",
    },
  };
}

export type WorkspacePerformanceReport = Awaited<
  ReturnType<typeof getWorkspacePerformanceReport>
>;
