import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentWorkspaceContext,
  subscriptionFindUnique,
  usageRecordFindUnique,
} = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  subscriptionFindUnique: vi.fn(),
  usageRecordFindUnique: vi.fn(),
}));

vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext }));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    subscription: { findUnique: subscriptionFindUnique },
    usageRecord: { findUnique: usageRecordFindUnique },
  },
}));

import { GET } from "@/app/api/billing/overview/route";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentWorkspaceContext.mockResolvedValue({
    workspaceId: "workspace_1",
    role: "OWNER",
    workspace: {
      dmsSentThisPeriod: 125,
      usagePeriodStart: new Date("2026-09-01T00:00:00.000Z"),
    },
  });
  usageRecordFindUnique.mockResolvedValue({ quantity: 140 });
  subscriptionFindUnique.mockResolvedValue({
    provider: "MANUAL",
    status: "ACTIVE",
    currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
    currentPeriodEnd: null,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    plan: {
      code: "PRO",
      name: "Pro",
      currency: "BRL",
      monthlyPriceCents: null,
      monthlyDmLimit: 2_000,
      instagramAccounts: 3,
      members: 10,
    },
  });
});

describe("GET /api/billing/overview", () => {
  it("requires an authenticated workspace", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(subscriptionFindUnique).not.toHaveBeenCalled();
  });

  it("scopes the subscription lookup to the active workspace", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(subscriptionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "workspace_1" } })
    );
    expect(usageRecordFindUnique).toHaveBeenCalledWith({
      where: {
        workspaceId_metric_periodStart: {
          workspaceId: "workspace_1",
          metric: "DM_SENT",
          periodStart: new Date("2026-09-01T00:00:00.000Z"),
        },
      },
      select: { quantity: true },
    });
    expect(payload.data.usage).toEqual({
      used: 140,
      limit: 2_000,
      remaining: 1_860,
      percentage: 7,
    });
    expect(payload.data.subscription.statusLabel).toBe("Ativa");
    expect(payload.data.checkoutAvailable).toBe(false);
  });

  it("does not invent a subscription while setup is incomplete", async () => {
    subscriptionFindUnique.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(409);
  });

  it("falls back to the legacy counter during a compatible deployment", async () => {
    usageRecordFindUnique.mockResolvedValue(null);

    const response = await GET();
    const payload = await response.json();

    expect(payload.data.usage.used).toBe(125);
  });
});
