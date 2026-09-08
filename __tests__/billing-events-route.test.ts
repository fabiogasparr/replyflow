import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentWorkspaceContext, mockPrisma } = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  mockPrisma: {
    billingEvent: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext,
  canManageBilling: (role: string) => role === "OWNER",
}));

import { GET } from "@/app/api/billing/events/route";
import { safeBillingFailureReason } from "@/lib/billing/presentation";

function request(query = "") {
  return new NextRequest(`http://localhost/api/billing/events${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentWorkspaceContext.mockResolvedValue({
    userId: "user_1",
    workspaceId: "workspace_1",
    role: "OWNER",
  });
  mockPrisma.billingEvent.findFirst.mockResolvedValue({ id: "event_cursor" });
  mockPrisma.billingEvent.findMany.mockResolvedValue([]);
  mockPrisma.billingEvent.groupBy.mockResolvedValue([]);
});

describe("GET /api/billing/events", () => {
  it("requires authentication before querying financial activity", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mockPrisma.billingEvent.findMany).not.toHaveBeenCalled();
  });

  it("keeps billing activity exclusive to workspace owners", async () => {
    getCurrentWorkspaceContext.mockResolvedValue({
      userId: "user_2",
      workspaceId: "workspace_1",
      role: "ADMIN",
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mockPrisma.billingEvent.findMany).not.toHaveBeenCalled();
  });

  it("rejects invalid filters without touching the database", async () => {
    const response = await GET(request("?status=UNKNOWN&limit=500"));

    expect(response.status).toBe(400);
    expect(mockPrisma.billingEvent.findMany).not.toHaveBeenCalled();
  });

  it("scopes, filters and paginates without selecting event metadata", async () => {
    const createdAt = new Date("2026-09-08T10:00:00.000Z");
    mockPrisma.billingEvent.findMany.mockResolvedValue([
      {
        id: "event_3",
        provider: "STRIPE",
        providerEventId: "evt_3",
        type: "subscription.failed",
        status: "FAILED",
        occurredAt: createdAt,
        processedAt: createdAt,
        failureReason: "token=should-not-leak",
        createdAt,
      },
      {
        id: "event_2",
        provider: "MERCADO_PAGO",
        providerEventId: "mp_2",
        type: "subscription.failed",
        status: "FAILED",
        occurredAt: createdAt,
        processedAt: createdAt,
        failureReason: "Plano indisponível",
        createdAt,
      },
      {
        id: "event_1",
        provider: "STRIPE",
        providerEventId: "evt_1",
        type: "subscription.failed",
        status: "FAILED",
        occurredAt: createdAt,
        processedAt: createdAt,
        failureReason: null,
        createdAt,
      },
    ]);
    mockPrisma.billingEvent.groupBy.mockResolvedValue([
      { status: "FAILED", _count: { _all: 3 } },
      { status: "PROCESSED", _count: { _all: 4 } },
    ]);

    const response = await GET(request("?status=FAILED&limit=2"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    const query = mockPrisma.billingEvent.findMany.mock.calls[0][0];
    expect(query).toMatchObject({
      where: { workspaceId: "workspace_1", status: "FAILED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
    });
    expect(query.select).not.toHaveProperty("metadata");
    expect(payload.data.events).toHaveLength(2);
    expect(payload.data.events[0]).toMatchObject({
      providerLabel: "Stripe",
      statusLabel: "Falhou",
      failureReason: "token=[credencial removida]",
    });
    expect(payload.data.summary).toEqual({
      PENDING: 0,
      PROCESSED: 4,
      FAILED: 3,
      IGNORED: 0,
    });
    expect(payload.data.nextCursor).toBe("event_2");
  });

  it("rejects a cursor outside the active workspace and filter", async () => {
    mockPrisma.billingEvent.findFirst.mockResolvedValue(null);

    const response = await GET(
      request("?status=PROCESSED&cursor=event_other")
    );

    expect(response.status).toBe(400);
    expect(mockPrisma.billingEvent.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        status: "PROCESSED",
        id: "event_other",
      },
      select: { id: true },
    });
    expect(mockPrisma.billingEvent.findMany).not.toHaveBeenCalled();
  });
});

describe("safeBillingFailureReason", () => {
  it("redacts bearer credentials and truncates oversized diagnostics", () => {
    const reason = `Authorization: Bearer abc.def.ghi ${"x".repeat(600)}`;
    const safe = safeBillingFailureReason(reason);

    expect(safe).not.toContain("abc.def.ghi");
    expect(safe?.length).toBeLessThanOrEqual(500);
  });
});
