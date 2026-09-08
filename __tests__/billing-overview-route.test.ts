import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentWorkspaceContext, subscriptionFindUnique } = vi.hoisted(
  () => ({
    getCurrentWorkspaceContext: vi.fn(),
    subscriptionFindUnique: vi.fn(),
  })
);

vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext }));
vi.mock("@/lib/db/client", () => ({
  prisma: { subscription: { findUnique: subscriptionFindUnique } },
}));

import { GET } from "@/app/api/billing/overview/route";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentWorkspaceContext.mockResolvedValue({
    workspaceId: "workspace_1",
    role: "OWNER",
    workspace: { dmsSentThisPeriod: 125 },
  });
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
    expect(payload.data.usage).toEqual({
      used: 125,
      limit: 2_000,
      remaining: 1_875,
      percentage: 6.3,
    });
    expect(payload.data.subscription.statusLabel).toBe("Ativa");
    expect(payload.data.checkoutAvailable).toBe(false);
  });

  it("does not invent a subscription while setup is incomplete", async () => {
    subscriptionFindUnique.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(409);
  });
});
