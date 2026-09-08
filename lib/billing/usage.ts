import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/app/generated/prisma/client";

function getMonthStart(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthEnd(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

async function resetUsageIfNeededTx(
  tx: Prisma.TransactionClient,
  workspaceId: string
): Promise<void> {
  const now = new Date();
  const monthStart = getMonthStart(now);

  await tx.workspace.updateMany({
    where: {
      id: workspaceId,
      usagePeriodStart: { lt: monthStart },
    },
    data: {
      usagePeriodStart: monthStart,
      dmsSentThisPeriod: 0,
    },
  });
}

export async function resetUsageIfNeeded(workspaceId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await resetUsageIfNeededTx(tx, workspaceId);
  });
}

export interface WorkspaceDMReservation {
  allowed: boolean;
  reserved: boolean;
  remaining: number;
  limit: number;
  periodStart: Date | null;
}

export async function reserveWorkspaceDMSend(
  workspaceId: string
): Promise<WorkspaceDMReservation> {
  return prisma.$transaction(async (tx) => {
    await resetUsageIfNeededTx(tx, workspaceId);

    const monthStart = getMonthStart();
    const monthEnd = getMonthEnd();
    const workspace = await tx.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        usagePeriodStart: true,
        subscription: {
          select: {
            plan: { select: { monthlyDmLimit: true } },
          },
        },
      },
    });

    const limit = workspace?.subscription?.plan.monthlyDmLimit;
    if (!workspace || !limit || limit < 1) {
      return {
        allowed: false,
        reserved: false,
        remaining: 0,
        limit: limit ?? 0,
        periodStart: workspace?.usagePeriodStart ?? null,
      };
    }

    const usageRecord = await tx.usageRecord.upsert({
      where: {
        workspaceId_metric_periodStart: {
          workspaceId,
          metric: "DM_SENT",
          periodStart: monthStart,
        },
      },
      create: {
        workspaceId,
        metric: "DM_SENT",
        periodStart: monthStart,
        periodEnd: monthEnd,
        quantity: 0,
      },
      update: { periodEnd: monthEnd },
      select: { id: true },
    });

    const reserved = await tx.usageRecord.updateMany({
      where: {
        id: usageRecord.id,
        quantity: { lt: limit },
      },
      data: { quantity: { increment: 1 } },
    });

    if (reserved.count === 0) {
      const current = await tx.usageRecord.findUnique({
        where: { id: usageRecord.id },
        select: { quantity: true },
      });

      return {
        allowed: false,
        reserved: false,
        remaining: Math.max(0, limit - (current?.quantity ?? limit)),
        limit,
        periodStart: workspace.usagePeriodStart,
      };
    }

    const mirrored = await tx.workspace.updateMany({
      where: {
        id: workspaceId,
        usagePeriodStart: { gte: monthStart },
      },
      data: { dmsSentThisPeriod: { increment: 1 } },
    });
    if (mirrored.count !== 1) {
      throw new Error("Não foi possível espelhar a reserva mensal do workspace");
    }

    const current = await tx.usageRecord.findUnique({
      where: { id: usageRecord.id },
      select: { quantity: true },
    });

    return {
      allowed: true,
      reserved: true,
      remaining: Math.max(0, limit - (current?.quantity ?? limit)),
      limit,
      periodStart: workspace.usagePeriodStart,
    };
  });
}

export async function canSendDMForWorkspace(workspaceId: string): Promise<{
  allowed: boolean;
  remaining: number;
  limit: number;
}> {
  return prisma.$transaction(async (tx) => {
    await resetUsageIfNeededTx(tx, workspaceId);

    const monthStart = getMonthStart();
    const monthEnd = getMonthEnd();
    const workspace = await tx.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        subscription: {
          select: { plan: { select: { monthlyDmLimit: true } } },
        },
      },
    });
    const limit = workspace?.subscription?.plan.monthlyDmLimit;
    if (!workspace || !limit || limit < 1) {
      return { allowed: false, remaining: 0, limit: limit ?? 0 };
    }

    const usage = await tx.usageRecord.upsert({
      where: {
        workspaceId_metric_periodStart: {
          workspaceId,
          metric: "DM_SENT",
          periodStart: monthStart,
        },
      },
      create: {
        workspaceId,
        metric: "DM_SENT",
        periodStart: monthStart,
        periodEnd: monthEnd,
        quantity: 0,
      },
      update: { periodEnd: monthEnd },
      select: { quantity: true },
    });
    const remaining = Math.max(0, limit - usage.quantity);

    return {
      allowed: usage.quantity < limit,
      remaining,
      limit,
    };
  });
}

export async function releaseWorkspaceDMReservation(
  workspaceId: string,
  periodStart: Date | null
) {
  if (!periodStart) {
    return { count: 0 };
  }

  return prisma.$transaction(async (tx) => {
    const released = await tx.usageRecord.updateMany({
      where: {
        workspaceId,
        metric: "DM_SENT",
        periodStart,
        quantity: { gt: 0 },
      },
      data: { quantity: { decrement: 1 } },
    });

    if (released.count === 1) {
      await tx.workspace.updateMany({
        where: {
          id: workspaceId,
          usagePeriodStart: periodStart,
          dmsSentThisPeriod: { gt: 0 },
        },
        data: { dmsSentThisPeriod: { decrement: 1 } },
      });
    }

    return released;
  });
}

export async function incrementWorkspaceDMUsage(workspaceId: string) {
  return reserveWorkspaceDMSend(workspaceId);
}
