import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRedisConnection, redis } = vi.hoisted(() => ({
  getRedisConnection: vi.fn(),
  redis: {
    get: vi.fn(),
    lrange: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
  },
}));

vi.mock("@/lib/queue/client", () => ({ getRedisConnection }));

import {
  getWorkerAlerts,
  getWorkerHealth,
  recordWorkerAlert,
} from "@/lib/ops/worker-health";

beforeEach(() => {
  vi.clearAllMocks();
  getRedisConnection.mockReturnValue(redis);
});

describe("workspace-scoped worker alerts", () => {
  it("returns only alerts that belong to the requested workspace", async () => {
    redis.lrange.mockResolvedValue([
      JSON.stringify({
        workspaceId: "workspace_2",
        level: "error",
        message: "falha de outro cliente",
        commentId: "comment_other",
        createdAt: "2026-09-04T12:00:00.000Z",
      }),
      JSON.stringify({
        workspaceId: "workspace_1",
        level: "error",
        message: "falha deste cliente",
        commentId: "comment_own",
        createdAt: "2026-09-04T12:01:00.000Z",
      }),
      JSON.stringify({
        level: "error",
        message: "alerta antigo sem escopo",
        commentId: "comment_legacy",
        createdAt: "2026-09-04T12:02:00.000Z",
      }),
      JSON.stringify({
        workspaceId: "workspace_1",
        level: "error",
        createdAt: "2026-09-04T12:03:00.000Z",
      }),
    ]);

    await expect(getWorkerAlerts("workspace_1", 10)).resolves.toEqual([
      expect.objectContaining({
        workspaceId: "workspace_1",
        commentId: "comment_own",
      }),
    ]);
    expect(redis.lrange).toHaveBeenCalledWith("alerts:worker:dm", 0, -1);
  });

  it("persists the workspace scope with every new alert", async () => {
    await recordWorkerAlert({
      workspaceId: "workspace_1",
      level: "error",
      message: "falha",
      commentId: "comment_1",
    });

    const storedPayload = JSON.parse(redis.lpush.mock.calls[0]?.[1] as string);
    expect(storedPayload).toMatchObject({
      workspaceId: "workspace_1",
      level: "error",
      message: "falha",
      commentId: "comment_1",
    });
    expect(storedPayload.createdAt).toEqual(expect.any(String));
  });
});

describe("worker heartbeat validation", () => {
  it("treats malformed or incomplete Redis payloads as unavailable", async () => {
    redis.get.mockResolvedValueOnce('{"status":"running","checkedAt":"invalid"}');
    await expect(getWorkerHealth()).resolves.toEqual({
      healthy: false,
      heartbeat: null,
      ageMs: null,
    });
  });

  it("clamps a small clock skew instead of reporting negative age", async () => {
    redis.get.mockResolvedValueOnce(
      JSON.stringify({
        status: "running",
        worker: "dm",
        pid: 123,
        checkedAt: new Date(Date.now() + 5_000).toISOString(),
      })
    );

    const health = await getWorkerHealth();
    expect(health.healthy).toBe(true);
    expect(health.ageMs).toBe(0);
  });
});
