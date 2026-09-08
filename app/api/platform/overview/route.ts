import type { Prisma } from "@/app/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getPlatformAccess } from "@/lib/platform-admin";

export const runtime = "nodejs";

const querySchema = z.object({
  q: z.string().trim().max(80).optional(),
  plan: z.enum(["FREE", "PRO", "AGENCY"]).optional(),
  status: z
    .enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "INCOMPLETE"])
    .optional(),
  archived: z.enum(["active", "archived", "all"]).default("active"),
  cursor: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const PLAN_CODES = ["FREE", "PRO", "AGENCY"] as const;
const SUBSCRIPTION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "INCOMPLETE",
] as const;

function startOfCurrentMonth(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function GET(request: NextRequest) {
  const access = await getPlatformAccess();
  if (!access.authenticated) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  if (!access.admin) {
    return NextResponse.json(
      { success: false, error: "Acesso restrito à administração da plataforma" },
      { status: 403 }
    );
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Filtros inválidos" },
      { status: 400 }
    );
  }

  const { q, plan, status, archived, cursor, limit } = parsed.data;
  const where: Prisma.WorkspaceWhereInput = {
    ...(archived === "active"
      ? { archivedAt: null }
      : archived === "archived"
        ? { archivedAt: { not: null } }
        : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { owner: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(plan || status
      ? {
          subscription: {
            is: {
              ...(plan ? { planCode: plan } : {}),
              ...(status ? { status } : {}),
            },
          },
        }
      : {}),
  };

  if (cursor) {
    const validCursor = await prisma.workspace.findFirst({
      where: { ...where, id: cursor },
      select: { id: true },
    });
    if (!validCursor) {
      return NextResponse.json(
        { success: false, error: "Cursor inválido para os filtros atuais" },
        { status: 400 }
      );
    }
  }

  const now = new Date();
  const monthStart = startOfCurrentMonth(now);
  const [
    rows,
    filteredWorkspaceCount,
    activeWorkspaceCount,
    archivedWorkspaceCount,
    userCount,
    instagramAccountCount,
    planGroups,
    statusGroups,
    monthlyUsage,
  ] = await Promise.all([
    prisma.workspace.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1,
      select: {
        id: true,
        name: true,
        createdAt: true,
        archivedAt: true,
        owner: { select: { id: true, name: true, email: true } },
        subscription: {
          select: {
            provider: true,
            status: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            trialEndsAt: true,
            cancelAtPeriodEnd: true,
            plan: {
              select: {
                code: true,
                name: true,
                currency: true,
                monthlyPriceCents: true,
                monthlyDmLimit: true,
                instagramAccounts: true,
                members: true,
              },
            },
          },
        },
        usageRecords: {
          where: { metric: "DM_SENT" },
          orderBy: { periodStart: "desc" },
          take: 1,
          select: { quantity: true, periodStart: true, periodEnd: true },
        },
        instagramAccounts: {
          select: { tokenExpiresAt: true, webhookSubscribed: true },
        },
        _count: {
          select: {
            instagramAccounts: true,
            members: true,
            automations: true,
          },
        },
      },
    }),
    prisma.workspace.count({ where }),
    prisma.workspace.count({ where: { archivedAt: null } }),
    prisma.workspace.count({ where: { archivedAt: { not: null } } }),
    prisma.user.count(),
    prisma.instagramAccount.count(),
    prisma.subscription.groupBy({
      by: ["planCode"],
      _count: { _all: true },
    }),
    prisma.subscription.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.usageRecord.aggregate({
      where: { metric: "DM_SENT", periodStart: { gte: monthStart } },
      _sum: { quantity: true },
    }),
  ]);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const workspaces = pageRows.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
    archivedAt: workspace.archivedAt,
    owner: workspace.owner,
    subscription: workspace.subscription,
    usage: workspace.usageRecords[0] ?? null,
    resources: workspace._count,
    alerts: {
      expiredTokens: workspace.instagramAccounts.filter(
        (account) => account.tokenExpiresAt && account.tokenExpiresAt <= now
      ).length,
      pendingWebhooks: workspace.instagramAccounts.filter(
        (account) => !account.webhookSubscribed
      ).length,
    },
  }));

  return NextResponse.json({
    success: true,
    data: {
      generatedAt: now,
      summary: {
        workspaces: {
          filtered: filteredWorkspaceCount,
          active: activeWorkspaceCount,
          archived: archivedWorkspaceCount,
        },
        users: userCount,
        instagramAccounts: instagramAccountCount,
        dmsSentThisMonth: monthlyUsage._sum.quantity ?? 0,
        subscriptionsByPlan: Object.fromEntries(
          PLAN_CODES.map((code) => [
            code,
            planGroups.find((group) => group.planCode === code)?._count._all ?? 0,
          ])
        ),
        subscriptionsByStatus: Object.fromEntries(
          SUBSCRIPTION_STATUSES.map((subscriptionStatus) => [
            subscriptionStatus,
            statusGroups.find((group) => group.status === subscriptionStatus)
              ?._count._all ?? 0,
          ])
        ),
      },
      workspaces,
      nextCursor: hasMore ? pageRows.at(-1)?.id ?? null : null,
    },
  });
}

