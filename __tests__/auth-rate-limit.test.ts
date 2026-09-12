import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), eval: vi.fn(), disconnect: vi.fn(), on: vi.fn(), constructor: vi.fn() }));
vi.mock("ioredis", () => ({ default: class {
  constructor(...args: unknown[]) { mocks.constructor(...args); }
  connect = mocks.connect; eval = mocks.eval; disconnect = mocks.disconnect; on = mocks.on;
} }));
import { getAuthEmailLimitKeys, reserveAuthEmailSlot, reserveAuthEmail } from "@/lib/auth-rate-limit";

beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs();
  vi.stubEnv("NEXTAUTH_SECRET", "synthetic-auth-rate-limit-secret");
  vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  mocks.connect.mockResolvedValue(undefined); mocks.eval.mockResolvedValue([1, 0]);
});

describe("authentication email rate limiting", () => {
  it("normalizes private recipient keys and separates installations by secret", () => {
    const first = getAuthEmailLimitKeys(" Owner@Example.com ", "a".repeat(32));
    expect(first).toEqual(getAuthEmailLimitKeys("owner@example.com", "a".repeat(32)));
    expect(first).not.toEqual(getAuthEmailLimitKeys("owner@example.com", "b".repeat(32)));
    expect(first.join()).not.toContain("owner");
    expect(first.join()).not.toContain("example.com");
    expect(new Set(first.map((key) => key.match(/\{[^}]+\}/)?.[0])).size).toBe(1);
  });
  it("reserves all limits in one atomic script without raw recipient arguments", async () => {
    expect(await reserveAuthEmailSlot({ eval: mocks.eval }, "owner@example.com", "a".repeat(32))).toEqual({ allowed: true });
    expect(mocks.eval.mock.calls[0].slice(-5)).toEqual([300, 3600, 5, 900, 60]);
    expect(JSON.stringify(mocks.eval.mock.calls)).not.toContain("owner@example.com");
  });
  it("returns the retry interval supplied by Redis", async () => {
    mocks.eval.mockResolvedValue([0, 42]);
    expect(await reserveAuthEmail("owner@example.com")).toEqual({ allowed: false, reason: "limited", retryAfterSeconds: 42 });
    expect(mocks.disconnect).toHaveBeenCalled();
  });
  it("uses bounded connection and request timeouts without an offline queue", async () => {
    await reserveAuthEmail("owner@example.com");
    expect(mocks.constructor).toHaveBeenCalledWith("redis://localhost:6379", expect.objectContaining({
      lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, connectTimeout: 2000, commandTimeout: 2000,
    }));
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, [1, 9], [0, -1], "unexpected"])("fails closed for malformed Redis replies: %j", async (reply) => {
    mocks.eval.mockResolvedValue(reply);
    expect(await reserveAuthEmail("owner@example.com")).toMatchObject({ allowed: false, reason: "unavailable" });
  });
  it("fails closed without leaking connection errors", async () => {
    mocks.connect.mockRejectedValue(new Error("redis://private-secret@internal"));
    const result = await reserveAuthEmail("owner@example.com");
    expect(result).toMatchObject({ allowed: false, reason: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("private-secret");
    expect(mocks.eval).not.toHaveBeenCalled();
    expect(mocks.disconnect).toHaveBeenCalled();
  });
  it.each(["0", "-1", "1.2", "invalid", "100001", ""])("rejects invalid global budget %j before connecting", async (value) => {
    vi.stubEnv("AUTH_EMAIL_GLOBAL_LIMIT", value);
    expect(await reserveAuthEmail("owner@example.com")).toMatchObject({ allowed: false, reason: "unavailable" });
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
  it("does not bypass protection when Redis or the namespace secret is absent", async () => {
    vi.stubEnv("REDIS_URL", "");
    expect(await reserveAuthEmail("owner@example.com")).toMatchObject({ allowed: false, reason: "unavailable" });
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
});
