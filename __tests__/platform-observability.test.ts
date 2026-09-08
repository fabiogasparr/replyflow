import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queue: vi.fn(),
  worker: vi.fn(),
  email: vi.fn(),
  prisma: {
    webhookEvent: { groupBy: vi.fn() },
    dmLog: { groupBy: vi.fn() },
    operationalEvent: { groupBy: vi.fn() },
    automation: { groupBy: vi.fn() },
    billingEvent: { groupBy: vi.fn() },
    instagramAccount: { groupBy: vi.fn() },
    session: { count: vi.fn() },
    user: { count: vi.fn() },
    workspace: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/ops/queue-observability", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/lib/ops/queue-observability")
  >();
  return { ...original, getPlatformQueueSnapshot: mocks.queue };
});
vi.mock("@/lib/ops/worker-health", () => ({ getWorkerHealth: mocks.worker }));
vi.mock("@/lib/auth-readiness", () => ({ getEmailAuthReadiness: mocks.email }));

import {
  compareFailureRates,
  getPlatformOperationsSnapshot,
} from "@/lib/ops/platform-observability";

const healthyQueue = {
  status: "IDLE" as const,
  counts: { waiting: 0, active: 0, delayed: 0, failed: 0 },
  oldestWaitingAt: null,
  oldestWaitingAgeMs: null,
  nextDelayedAt: null,
  truncated: false,
  scanLimit: 1_000,
  checkedAt: "2026-09-08T12:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queue.mockResolvedValue(healthyQueue);
  mocks.worker.mockResolvedValue({
    healthy: true,
    ageMs: 5_000,
    heartbeat: {
      status: "running",
      worker: "dm",
      pid: 123,
      hostname: "private-host",
      startedAt: "2026-09-08T11:00:00.000Z",
      checkedAt: "2026-09-08T11:59:55.000Z",
    },
  });
  mocks.email.mockReturnValue({ ready: true, provider: "resend", message: null });
  mocks.prisma.webhookEvent.groupBy.mockResolvedValue([]);
  mocks.prisma.dmLog.groupBy.mockResolvedValue([]);
  mocks.prisma.operationalEvent.groupBy.mockResolvedValue([]);
  mocks.prisma.automation.groupBy.mockResolvedValue([]);
  mocks.prisma.billingEvent.groupBy.mockResolvedValue([]);
  mocks.prisma.instagramAccount.groupBy.mockResolvedValue([]);
  mocks.prisma.session.count.mockResolvedValue(0);
  mocks.prisma.user.count.mockResolvedValue(0);
  mocks.prisma.workspace.findMany.mockResolvedValue([]);
});

describe("platform observability calculations", () => {
  it("compares issue rates with the equivalent previous period", () => {
    const comparison = compareFailureRates(
      [
        { status: "FAILED", _count: { _all: 10 } },
        { status: "PROCESSED", _count: { _all: 30 } },
      ],
      [
        { status: "FAILED", _count: { _all: 1 } },
        { status: "PROCESSED", _count: { _all: 39 } },
      ],
      (group) => group.status === "FAILED"
    );

    expect(comparison).toEqual({
      current: { total: 40, issues: 10, rate: 25 },
      previous: { total: 40, issues: 1, rate: 2.5 },
      trend: "UP",
      anomaly: true,
      severity: "CRITICAL",
    });
  });

  it("returns a healthy, secret-free snapshot when all services are nominal", async () => {
    const snapshot = await getPlatformOperationsSnapshot(
      "24h",
      new Date("2026-09-08T12:00:00.000Z")
    );

    expect(snapshot.status).toBe("HEALTHY");
    expect(snapshot.issues).toEqual([]);
    expect(snapshot.services).toMatchObject({
      database: { available: true },
      redis: { available: true },
      worker: { healthy: true, ageMs: 5_000 },
      emailAuthentication: { ready: true, provider: "resend" },
    });
    expect(JSON.stringify(snapshot)).not.toContain("private-host");
    expect(JSON.stringify(snapshot)).not.toContain('"pid"');
    expect(mocks.prisma.webhookEvent.groupBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          createdAt: { gte: new Date("2026-09-07T12:00:00.000Z") },
        },
      })
    );
    expect(mocks.prisma.webhookEvent.groupBy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          createdAt: {
            gte: new Date("2026-09-06T12:00:00.000Z"),
            lt: new Date("2026-09-07T12:00:00.000Z"),
          },
        },
      })
    );
  });

  it("ranks affected workspaces and flags operational anomalies", async () => {
    mocks.prisma.webhookEvent.groupBy
      .mockResolvedValueOnce([
        { workspaceId: "workspace_1", status: "FAILED", _count: { _all: 3 } },
        { workspaceId: "workspace_1", status: "PROCESSED", _count: { _all: 7 } },
      ])
      .mockResolvedValueOnce([
        { workspaceId: "workspace_1", status: "PROCESSED", _count: { _all: 10 } },
      ]);
    mocks.prisma.dmLog.groupBy
      .mockResolvedValueOnce([
        { workspaceId: "workspace_1", status: "FAILED", _count: { _all: 10 } },
        { workspaceId: "workspace_1", status: "SENT", _count: { _all: 10 } },
      ])
      .mockResolvedValueOnce([
        { workspaceId: "workspace_1", status: "SENT", _count: { _all: 20 } },
      ]);
    mocks.prisma.operationalEvent.groupBy
      .mockResolvedValueOnce([
        { workspaceId: "workspace_1", source: "WORKER", level: "ERROR", _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([
        { workspaceId: "workspace_1", source: "WORKER", level: "INFO", _count: { _all: 10 } },
      ]);
    mocks.prisma.automation.groupBy.mockResolvedValue([
      { workspaceId: "workspace_1", lastErrorKind: "AUTHENTICATION", _count: { _all: 1 } },
    ]);
    mocks.prisma.billingEvent.groupBy.mockResolvedValue([
      { workspaceId: "workspace_1", status: "FAILED", _count: { _all: 1 } },
    ]);
    mocks.prisma.instagramAccount.groupBy
      .mockResolvedValueOnce([
        { workspaceId: "workspace_1", _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([
        { workspaceId: "workspace_1", _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { workspaceId: "workspace_1", _count: { _all: 1 } },
      ]);
    mocks.prisma.workspace.findMany.mockResolvedValue([
      { id: "workspace_1", name: "Loja Exemplo", archivedAt: null },
    ]);

    const snapshot = await getPlatformOperationsSnapshot(
      "24h",
      new Date("2026-09-08T12:00:00.000Z")
    );

    expect(snapshot.status).toBe("CRITICAL");
    expect(snapshot.metrics?.webhooks.comparison).toMatchObject({
      anomaly: true,
      trend: "UP",
    });
    expect(snapshot.metrics?.deliveries.comparison.severity).toBe("CRITICAL");
    expect(snapshot.metrics?.incidentWorkspaces[0]).toMatchObject({
      workspaceId: "workspace_1",
      name: "Loja Exemplo",
      webhookFailures: 3,
      deliveryFailures: 10,
      operationalErrors: 3,
      authenticationErrors: 1,
      billingProblems: 1,
      expiredTokens: 2,
      expiringTokens: 1,
      pendingWebhooks: 1,
    });
    expect(snapshot.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "TOKENS_EXPIRED",
        "WEBHOOK_FAILURE_ANOMALY",
        "DELIVERY_FAILURE_ANOMALY",
        "OPERATIONAL_ERROR_ANOMALY",
        "BILLING_EVENTS_FAILED",
      ])
    );
  });

  it("keeps isolated failures visible even below the anomaly threshold", async () => {
    mocks.prisma.webhookEvent.groupBy
      .mockResolvedValueOnce([
        { workspaceId: null, status: "FAILED", _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([]);

    const snapshot = await getPlatformOperationsSnapshot("1h");

    expect(snapshot.status).toBe("DEGRADED");
    expect(snapshot.metrics?.webhooks.comparison.anomaly).toBe(false);
    expect(snapshot.issues).toContainEqual(
      expect.objectContaining({ code: "WEBHOOK_FAILURES", severity: "WARNING" })
    );
  });

  it("degrades safely without exposing connection errors", async () => {
    mocks.queue.mockRejectedValue(new Error("redis://secret@host"));
    mocks.worker.mockRejectedValue(new Error("redis://secret@host"));

    const snapshot = await getPlatformOperationsSnapshot("1h");

    expect(snapshot.status).toBe("CRITICAL");
    expect(snapshot.services.redis.available).toBe(false);
    expect(snapshot.services.queue.status).toBe("UNAVAILABLE");
    expect(JSON.stringify(snapshot)).not.toContain("redis://");
  });
});
