import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  getJobs: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: { instagramAccount: { findMany: mocks.accounts } },
}));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ getJobs: mocks.getJobs }),
}));

import {
  getWorkspaceQueueSnapshot,
  summarizePlatformQueueJobs,
  summarizeWorkspaceQueueJobs,
} from "@/lib/ops/queue-observability";

const now = new Date("2026-09-05T12:10:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.accounts.mockResolvedValue([{ instagramId: "account_own" }]);
  mocks.getJobs.mockResolvedValue([]);
});

describe("workspace queue observability", () => {
  it("filters every state by the workspace account before counting", () => {
    const snapshot = summarizeWorkspaceQueueJobs(
      {
        waiting: [
          { data: { instagramAccountId: "account_own" }, timestamp: now.getTime() - 90_000 },
          { data: { instagramAccountId: "account_other" }, timestamp: now.getTime() - 600_000 },
        ],
        active: [{ data: { instagramAccountId: "account_own" }, processedOn: now.getTime() - 20_000 }],
        delayed: [{ data: { instagramAccountId: "account_other" }, timestamp: now.getTime(), delay: 5_000 }],
        failed: [{ data: { instagramAccountId: "account_own" } }],
      },
      ["account_own"],
      now
    );

    expect(snapshot).toMatchObject({
      status: "DEGRADED",
      counts: { waiting: 1, active: 1, delayed: 0, failed: 1 },
      oldestWaitingAgeMs: 90_000,
      oldestWaitingAt: "2026-09-05T12:08:30.000Z",
      nextDelayedAt: null,
      truncated: false,
    });
  });

  it("classifies critical lag and reports the next scheduled delivery", () => {
    const snapshot = summarizeWorkspaceQueueJobs(
      {
        waiting: [{ data: { instagramAccountId: "account_own" }, timestamp: now.getTime() - 360_000 }],
        active: [],
        delayed: [{ data: { instagramAccountId: "account_own" }, timestamp: now.getTime(), delay: 120_000 }],
        failed: [],
      },
      ["account_own"],
      now,
      { scanLimit: 1 }
    );

    expect(snapshot.status).toBe("CRITICAL");
    expect(snapshot.nextDelayedAt).toBe("2026-09-05T12:12:00.000Z");
    expect(snapshot.truncated).toBe(true);
  });

  it("returns an idle snapshot when this workspace has no queued jobs", () => {
    expect(
      summarizeWorkspaceQueueJobs(
        { waiting: [], active: [], delayed: [], failed: [] },
        [],
        now
      )
    ).toMatchObject({ status: "IDLE", oldestWaitingAgeMs: null });
  });

  it("marks retained failed jobs as degraded even without queue lag", () => {
    expect(
      summarizePlatformQueueJobs(
        { waiting: [], active: [], delayed: [], failed: [{}] },
        now
      )
    ).toMatchObject({
      status: "DEGRADED",
      counts: { waiting: 0, active: 0, delayed: 0, failed: 1 },
    });
  });

  it("summarizes every platform job without returning job payloads", () => {
    const snapshot = summarizePlatformQueueJobs(
      {
        waiting: [
          { data: { instagramAccountId: "account_1" }, timestamp: now.getTime() - 20_000 },
          { data: { instagramAccountId: "unknown" }, timestamp: now.getTime() - 10_000 },
        ],
        active: [],
        delayed: [],
        failed: [],
      },
      now
    );

    expect(snapshot.counts.waiting).toBe(2);
    expect(snapshot).not.toHaveProperty("jobs");
    expect(JSON.stringify(snapshot)).not.toContain("account_1");
  });

  it("loads only account identifiers from the requested workspace", async () => {
    mocks.getJobs.mockImplementation(async (state: string) =>
      state === "wait"
        ? [{ data: { instagramAccountId: "account_own" }, timestamp: Date.now() }]
        : []
    );

    const snapshot = await getWorkspaceQueueSnapshot("workspace_1");

    expect(mocks.accounts).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1" },
      select: { instagramId: true },
    });
    expect(mocks.getJobs).toHaveBeenCalledTimes(4);
    expect(snapshot.counts.waiting).toBe(1);
  });
});
