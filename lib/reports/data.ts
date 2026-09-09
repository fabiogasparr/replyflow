import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  calculateCtr,
  normalizeTopKeywords,
  summarizeDmStatuses,
} from "@/lib/tracking/analytics";
import { resolvePerformancePeriod, type ReportPreset } from "@/lib/reports/performance";
import {
  buildReportUrl,
  getBrandInitials,
  getReadableTextColor,
  isReportBranded,
} from "@/lib/reports/share";

type DailyMetricRow = {
  day: string;
  metric: "SENT" | "CLICK";
  count: number | bigint;
};

function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function deliveryRate(sent: number, failed: number) {
  const attempted = sent + failed;
  return attempted === 0 ? 0 : Math.round((sent / attempted) * 1_000) / 10;
}

export async function getCampaignReportBySlug(
  shareSlug: string,
  now = new Date()
) {
  const automation = await prisma.automation.findFirst({
    where: {
      reportShareSlug: shareSlug,
      reportShareEnabled: true,
    },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      goal: true,
      postUrl: true,
      keywords: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      reportShareSlug: true,
      reportSharePeriodDays: true,
      reportSharePublishedAt: true,
      workspace: {
        select: {
          name: true,
          reportBrandName: true,
          reportBrandColor: true,
        },
      },
      instagramAccount: {
        select: {
          username: true,
        },
      },
      trackedLinks: {
        select: {
          id: true,
          slug: true,
          destinationUrl: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!automation?.reportShareSlug) return null;

  const periodDays = [7, 30, 90].includes(automation.reportSharePeriodDays)
    ? automation.reportSharePeriodDays
    : 30;
  const period = resolvePerformancePeriod(
    { preset: `${periodDays}d` as ReportPreset },
    now
  );
  const metricWhere = {
    workspaceId: automation.workspaceId,
    automationId: automation.id,
    createdAt: { gte: period.start, lt: period.endExclusive },
  };

  const [statusRows, clickRows, keywordRows, latestSentLog, dailyRows] =
    await Promise.all([
      prisma.dmLog.groupBy({
        by: ["status"],
        where: metricWhere,
        _count: { _all: true },
      }),
      prisma.linkClick.groupBy({
        by: ["trackedLinkId"],
        where: metricWhere,
        _count: { _all: true },
      }),
      prisma.dmLog.groupBy({
        by: ["matchedKeyword"],
        where: { ...metricWhere, matchedKeyword: { not: null } },
        _count: { _all: true },
      }),
      prisma.dmLog.findFirst({
        where: { ...metricWhere, status: "SENT" },
        orderBy: { dmSentAt: "desc" },
        select: { dmSentAt: true, createdAt: true },
      }),
      prisma.$queryRaw<DailyMetricRow[]>(Prisma.sql`
        SELECT
          TO_CHAR(("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${period.timeZone})::date, 'YYYY-MM-DD') AS day,
          'SENT'::text AS metric,
          COUNT(*)::int AS count
        FROM "DmLog"
        WHERE "workspaceId" = ${automation.workspaceId}
          AND "automationId" = ${automation.id}
          AND "createdAt" >= ${period.start}
          AND "createdAt" < ${period.endExclusive}
          AND "status" = 'SENT'::"DmStatus"
        GROUP BY 1
        UNION ALL
        SELECT
          TO_CHAR(("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${period.timeZone})::date, 'YYYY-MM-DD') AS day,
          'CLICK'::text AS metric,
          COUNT(*)::int AS count
        FROM "LinkClick"
        WHERE "workspaceId" = ${automation.workspaceId}
          AND "automationId" = ${automation.id}
          AND "createdAt" >= ${period.start}
          AND "createdAt" < ${period.endExclusive}
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
  const clickCounts = new Map(
    clickRows.map((row) => [row.trackedLinkId, row._count._all])
  );
  const clickCount = clickRows.reduce(
    (total, row) => total + row._count._all,
    0
  );
  const topKeywords = normalizeTopKeywords(
    keywordRows.map((row) => ({
      matchedKeyword: row.matchedKeyword,
      _count: row._count._all,
    }))
  );

  const dailyByKey = new Map<
    string,
    { date: string; sent: number; clicks: number }
  >(
    Array.from({ length: period.dayCount }, (_, index) => {
      const date = addDays(period.from, index);
      return [date, { date, sent: 0, clicks: 0 }];
    })
  );
  for (const row of dailyRows) {
    const day = dailyByKey.get(row.day);
    if (!day) continue;
    if (row.metric === "SENT") day.sent += Number(row.count);
    if (row.metric === "CLICK") day.clicks += Number(row.count);
  }

  const brandName = automation.workspace.reportBrandName ?? automation.workspace.name;
  const brandColor = automation.workspace.reportBrandColor;

  return {
    shareSlug: automation.reportShareSlug,
    reportUrl: buildReportUrl(automation.reportShareSlug),
    generatedAt: now,
    branded: isReportBranded(),
    branding: {
      name: brandName,
      color: brandColor,
      textColor: getReadableTextColor(brandColor),
      initials: getBrandInitials(brandName),
    },
    workspace: {
      name: automation.workspace.name,
    },
    period: {
      days: periodDays,
      from: period.from,
      to: period.to,
      timeZone: period.timeZone,
    },
    campaign: {
      name: automation.name,
      goal: automation.goal,
      postUrl: automation.postUrl,
      keywords: automation.keywords,
      isActive: automation.isActive,
      createdAt: automation.createdAt,
      updatedAt: automation.updatedAt,
      publishedAt: automation.reportSharePublishedAt,
      instagramUsername: automation.instagramAccount.username,
    },
    metrics: {
      sent: statusSummary.sent,
      skipped: statusSummary.skipped,
      failed: statusSummary.failed,
      clicks: clickCount,
      ctr: calculateCtr(clickCount, statusSummary.sent),
      deliveryRate: deliveryRate(statusSummary.sent, statusSummary.failed),
      latestSentAt: latestSentLog?.dmSentAt ?? latestSentLog?.createdAt ?? null,
    },
    topKeywords,
    daily: [...dailyByKey.values()],
    trackedLinks: automation.trackedLinks.map((link) => ({
      slug: link.slug,
      destinationHost: getHostname(link.destinationUrl),
      clicks: clickCounts.get(link.id) ?? 0,
    })),
    conversion: {
      available: false,
      reason:
        "Vendas exigem um evento comercial integrado; cliques não são apresentados como conversões.",
    },
  };
}

export type CampaignSharedReport = NonNullable<
  Awaited<ReturnType<typeof getCampaignReportBySlug>>
>;
