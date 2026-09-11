import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), ping: vi.fn(), counts: vi.fn(), health: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock("@/lib/queue/client", () => ({ getRedisConnection: () => ({ ping: mocks.ping }), getDMQueue: () => ({ getJobCounts: mocks.counts }) }));
vi.mock("@/lib/ops/worker-health", () => ({ getWorkerHealth: mocks.health }));
import { GET } from "@/app/api/health/route";

describe("public deployment health", () => {
  it("does not expose internal hostnames, process IDs or tenant queue counts", async () => {
    mocks.query.mockResolvedValue([]);
    mocks.ping.mockResolvedValue("PONG");
    mocks.counts.mockResolvedValue({ waiting: 173 });
    mocks.health.mockResolvedValue({ healthy: true, heartbeat: { hostname: "internal-secret-host", pid: 123 }, ageMs: 1 });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", checks: {
      database: { status: "ok" }, redis: { status: "ok" }, queue: { status: "ok" }, worker: { status: "ok" },
    } });
  });
  it("fails health without disclosing database credentials in exception messages", async () => {
    mocks.query.mockRejectedValue(new Error("postgres://user:secret@internal-host/db"));
    mocks.ping.mockResolvedValue("PONG");
    mocks.counts.mockResolvedValue({});
    mocks.health.mockResolvedValue({ healthy: false });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|internal-host|postgres:/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
