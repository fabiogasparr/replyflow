import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  queue: vi.fn(),
  health: vi.fn(),
  alerts: vi.fn(),
  prisma: {
    webhookEvent: { findMany: vi.fn() },
    dmLog: { findMany: vi.fn() },
    operationalEvent: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.context,
}));
vi.mock("@/lib/ops/queue-observability", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/lib/ops/queue-observability")
  >();
  return { ...original, getWorkspaceQueueSnapshot: mocks.queue };
});
vi.mock("@/lib/ops/worker-health", () => ({
  getWorkerHealth: mocks.health,
  getWorkerAlerts: mocks.alerts,
}));

import { GET } from "@/app/api/admin/diagnostics/route";

const queueSnapshot = {
  status: "HEALTHY" as const,
  counts: { waiting: 1, active: 0, delayed: 0, failed: 0 },
  oldestWaitingAt: "2026-09-05T12:00:00.000Z",
  oldestWaitingAgeMs: 5_000,
  nextDelayedAt: null,
  truncated: false,
  scanLimit: 1_000,
  checkedAt: "2026-09-05T12:00:05.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({
    userId: "user_1",
    workspaceId: "workspace_1",
    role: "MEMBER",
    workspace: { id: "workspace_1", name: "Empresa" },
  });
  mocks.queue.mockResolvedValue(queueSnapshot);
  mocks.health.mockResolvedValue({ healthy: true, heartbeat: null, ageMs: 5_000 });
  mocks.alerts.mockResolvedValue([]);
  mocks.prisma.webhookEvent.findMany.mockResolvedValue([]);
  mocks.prisma.dmLog.findMany.mockResolvedValue([]);
  mocks.prisma.operationalEvent.findMany.mockResolvedValue([]);
});

describe("GET /api/admin/diagnostics", () => {
  it("requires authentication before reading operational data", async () => {
    mocks.context.mockResolvedValueOnce(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("scopes queue and database failures to the active workspace", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.queue).toHaveBeenCalledWith("workspace_1");
    expect(mocks.alerts).toHaveBeenCalledWith("workspace_1", 10);
    expect(mocks.prisma.webhookEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "workspace_1", status: "FAILED" } })
    );
    expect(mocks.prisma.dmLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workspaceId: "workspace_1" }) })
    );
    expect(mocks.prisma.operationalEvent.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { workspaceId: "workspace_1" } })
    );
    expect(payload.data).toMatchObject({
      services: {
        database: { available: true },
        redis: { available: true },
        worker: { available: true },
      },
      queue: queueSnapshot,
      queueCounts: queueSnapshot.counts,
    });
  });

  it("keeps database diagnostics available during a Redis outage", async () => {
    mocks.queue.mockRejectedValueOnce(new Error("redis unavailable"));
    mocks.health.mockRejectedValueOnce(new Error("redis unavailable"));
    mocks.alerts.mockRejectedValueOnce(new Error("redis unavailable"));

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.services.redis.available).toBe(false);
    expect(payload.data.services.database.available).toBe(true);
    expect(payload.data.queue).toMatchObject({
      status: "UNAVAILABLE",
      counts: { waiting: 0, active: 0, delayed: 0, failed: 0 },
    });
    expect(payload.data.workerAlerts).toEqual([]);
  });
});
