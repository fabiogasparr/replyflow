import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockTx } = vi.hoisted(() => {
  const tx = {
    workspace: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    usageRecord: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };

  return {
    mockTx: tx,
    mockPrisma: {
      $transaction: vi.fn((callback: (txArg: typeof tx) => unknown) =>
        callback(tx)
      ),
    },
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import {
  canSendDMForWorkspace,
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";

const LIMIT = 100;
const periodStart = new Date(2026, 4, 1);
const periodEnd = new Date(2026, 5, 1);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-24T12:00:00.000Z"));

  mockTx.workspace.findUnique.mockResolvedValue({
    usagePeriodStart: periodStart,
    subscription: { plan: { monthlyDmLimit: LIMIT } },
  });
  mockTx.workspace.updateMany.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      count: "usagePeriodStart" in data ? 0 : 1,
    })
  );
  mockTx.usageRecord.upsert.mockResolvedValue({ id: "usage_1" });
  mockTx.usageRecord.updateMany.mockResolvedValue({ count: 1 });
  mockTx.usageRecord.findUnique.mockResolvedValue({ quantity: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reserveWorkspaceDMSend", () => {
  it("reserves the plan limit in UsageRecord and mirrors the workspace counter", async () => {
    const result = await reserveWorkspaceDMSend("workspace_123");

    expect(result).toEqual({
      allowed: true,
      reserved: true,
      remaining: 99,
      limit: LIMIT,
      periodStart,
    });
    expect(mockTx.usageRecord.upsert).toHaveBeenCalledWith({
      where: {
        workspaceId_metric_periodStart: {
          workspaceId: "workspace_123",
          metric: "DM_SENT",
          periodStart,
        },
      },
      create: {
        workspaceId: "workspace_123",
        metric: "DM_SENT",
        periodStart,
        periodEnd,
        quantity: 0,
      },
      update: { periodEnd },
      select: { id: true },
    });
    expect(mockTx.usageRecord.updateMany).toHaveBeenCalledWith({
      where: { id: "usage_1", quantity: { lt: LIMIT } },
      data: { quantity: { increment: 1 } },
    });
    expect(mockTx.workspace.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: "workspace_123",
        usagePeriodStart: { gte: periodStart },
      },
      data: { dmsSentThisPeriod: { increment: 1 } },
    });
  });

  it("denies atomically when persisted usage reached the plan limit", async () => {
    mockTx.usageRecord.updateMany.mockResolvedValue({ count: 0 });
    mockTx.usageRecord.findUnique.mockResolvedValue({ quantity: LIMIT });

    const result = await reserveWorkspaceDMSend("workspace_123");

    expect(result).toEqual({
      allowed: false,
      reserved: false,
      remaining: 0,
      limit: LIMIT,
      periodStart,
    });
    expect(mockTx.workspace.updateMany).toHaveBeenCalledTimes(1);
  });

  it("reports authoritative usage if a concurrent reservation wins", async () => {
    mockTx.usageRecord.updateMany.mockResolvedValue({ count: 0 });
    mockTx.usageRecord.findUnique.mockResolvedValue({ quantity: LIMIT });

    const result = await reserveWorkspaceDMSend("workspace_123");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("fails closed when billing setup has no subscription", async () => {
    mockTx.workspace.findUnique.mockResolvedValue({
      usagePeriodStart: periodStart,
      subscription: null,
    });

    const result = await reserveWorkspaceDMSend("workspace_123");

    expect(result).toEqual({
      allowed: false,
      reserved: false,
      remaining: 0,
      limit: 0,
      periodStart,
    });
    expect(mockTx.usageRecord.upsert).not.toHaveBeenCalled();
  });

  it("throws so the reservation rolls back when its mirror cannot update", async () => {
    mockTx.workspace.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      reserveWorkspaceDMSend("workspace_123")
    ).rejects.toThrow("espelhar a reserva mensal");
  });
});

describe("canSendDMForWorkspace", () => {
  it("reads the monthly limit from the subscribed database plan", async () => {
    mockTx.usageRecord.upsert.mockResolvedValue({ quantity: 40 });

    await expect(canSendDMForWorkspace("workspace_123")).resolves.toEqual({
      allowed: true,
      remaining: 60,
      limit: LIMIT,
    });
  });

  it("denies when usage equals the configured database limit", async () => {
    mockTx.usageRecord.upsert.mockResolvedValue({ quantity: LIMIT });

    await expect(canSendDMForWorkspace("workspace_123")).resolves.toEqual({
      allowed: false,
      remaining: 0,
      limit: LIMIT,
    });
  });
});

describe("releaseWorkspaceDMReservation", () => {
  it("decrements UsageRecord and its mirror in one transaction", async () => {
    await releaseWorkspaceDMReservation("workspace_123", periodStart);

    expect(mockTx.usageRecord.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_123",
        metric: "DM_SENT",
        periodStart,
        quantity: { gt: 0 },
      },
      data: { quantity: { decrement: 1 } },
    });
    expect(mockTx.workspace.updateMany).toHaveBeenCalledWith({
      where: {
        id: "workspace_123",
        usagePeriodStart: periodStart,
        dmsSentThisPeriod: { gt: 0 },
      },
      data: { dmsSentThisPeriod: { decrement: 1 } },
    });
  });

  it("does not decrement the workspace when no reservation exists", async () => {
    mockTx.usageRecord.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      releaseWorkspaceDMReservation("workspace_123", periodStart)
    ).resolves.toEqual({ count: 0 });
    expect(mockTx.workspace.updateMany).not.toHaveBeenCalled();
  });
});
