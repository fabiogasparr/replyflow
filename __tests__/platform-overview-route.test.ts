import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getPlatformAccess, mockPrisma } = vi.hoisted(() => ({
  getPlatformAccess: vi.fn(),
  mockPrisma: {
    workspace: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    user: { count: vi.fn() },
    instagramAccount: { count: vi.fn() },
    subscription: { groupBy: vi.fn() },
    usageRecord: { aggregate: vi.fn() },
  },
}));

vi.mock("@/lib/platform-admin", () => ({ getPlatformAccess }));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { GET } from "@/app/api/platform/overview/route";

function request(query = "") {
  return new NextRequest(`http://localhost/api/platform/overview${query}`);
}

function workspaceRow(id: string, createdAt: Date) {
  return {
    id,
    name: `Empresa ${id}`,
    createdAt,
    archivedAt: null,
    owner: { id: "owner_1", name: "Ana", email: "ana@example.com" },
    subscription: {
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
    },
    usageRecords: [
      {
        quantity: 320,
        periodStart: new Date("2026-09-01T00:00:00.000Z"),
        periodEnd: new Date("2026-10-01T00:00:00.000Z"),
      },
    ],
    instagramAccounts: [
      { tokenExpiresAt: new Date("2026-08-31T00:00:00.000Z"), webhookSubscribed: false },
    ],
    _count: { instagramAccounts: 1, members: 2, automations: 4 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T15:00:00.000Z"));
  getPlatformAccess.mockResolvedValue({
    authenticated: true,
    role: "ADMIN",
    admin: { id: "admin_1", name: "Admin", email: "admin@example.com" },
  });
  mockPrisma.workspace.findFirst.mockResolvedValue({ id: "workspace_cursor" });
  mockPrisma.workspace.findMany.mockResolvedValue([]);
  mockPrisma.workspace.count
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0);
  mockPrisma.user.count.mockResolvedValue(0);
  mockPrisma.instagramAccount.count.mockResolvedValue(0);
  mockPrisma.subscription.groupBy.mockResolvedValue([]);
  mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: null } });
});

describe("GET /api/platform/overview", () => {
  it("requires authentication before querying global data", async () => {
    getPlatformAccess.mockResolvedValue({ authenticated: false, role: null, admin: null });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mockPrisma.workspace.findMany).not.toHaveBeenCalled();
  });

  it("denies regular users even when they are authenticated", async () => {
    getPlatformAccess.mockResolvedValue({ authenticated: true, role: "USER", admin: null });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mockPrisma.workspace.findMany).not.toHaveBeenCalled();
  });

  it("rejects invalid filters without querying tenant data", async () => {
    const response = await GET(request("?plan=ENTERPRISE&limit=500"));

    expect(response.status).toBe(400);
    expect(mockPrisma.workspace.findMany).not.toHaveBeenCalled();
  });

  it("rejects a cursor outside the current filtered result", async () => {
    mockPrisma.workspace.findFirst.mockResolvedValue(null);

    const response = await GET(request("?cursor=workspace_other&plan=PRO"));

    expect(response.status).toBe(400);
    expect(mockPrisma.workspace.findMany).not.toHaveBeenCalled();
  });

  it("filters and paginates a secret-free global overview", async () => {
    const createdAt = new Date("2026-09-07T10:00:00.000Z");
    mockPrisma.workspace.findMany.mockResolvedValue([
      workspaceRow("workspace_2", createdAt),
      workspaceRow("workspace_1", createdAt),
    ]);
    mockPrisma.workspace.count
      .mockReset()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(1);
    mockPrisma.user.count.mockResolvedValue(12);
    mockPrisma.instagramAccount.count.mockResolvedValue(9);
    mockPrisma.subscription.groupBy
      .mockResolvedValueOnce([{ planCode: "PRO", _count: { _all: 5 } }])
      .mockResolvedValueOnce([{ status: "ACTIVE", _count: { _all: 7 } }]);
    mockPrisma.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: 4_200 } });

    const response = await GET(
      request("?q=ana%40example.com&plan=PRO&status=ACTIVE&limit=1")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    const query = mockPrisma.workspace.findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      archivedAt: null,
      OR: [
        { name: { contains: "ana@example.com", mode: "insensitive" } },
        { owner: { email: { contains: "ana@example.com", mode: "insensitive" } } },
      ],
      subscription: { is: { planCode: "PRO", status: "ACTIVE" } },
    });
    expect(query.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(query.take).toBe(2);
    expect(JSON.stringify(query.select)).not.toContain("accessToken");
    expect(JSON.stringify(query.select)).not.toContain("metadata");
    expect(payload.data.summary).toMatchObject({
      workspaces: { filtered: 2, active: 8, archived: 1 },
      users: 12,
      instagramAccounts: 9,
      dmsSentThisMonth: 4_200,
      subscriptionsByPlan: { FREE: 0, PRO: 5, AGENCY: 0 },
      subscriptionsByStatus: { ACTIVE: 7, PAST_DUE: 0 },
    });
    expect(payload.data.workspaces).toHaveLength(1);
    expect(payload.data.workspaces[0]).toMatchObject({
      id: "workspace_2",
      usage: { quantity: 320 },
      alerts: { expiredTokens: 1, pendingWebhooks: 1 },
    });
    expect(payload.data.nextCursor).toBe("workspace_2");
  });
});

