import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: { automation: { updateMany: mocks.updateMany } },
}));

import {
  classifyAutomationFailure,
  clearAutomationCredentialFailures,
  deriveAutomationOperationalState,
  recordAutomationFailure,
  recordAutomationSuccess,
  sanitizeAutomationError,
  type AutomationOperationalInput,
} from "@/lib/automations/operational-state";

const now = new Date("2026-09-05T12:00:00.000Z");
const active: AutomationOperationalInput = {
  isActive: true,
  pendingNextReel: false,
  postId: "media_1",
  lastRunAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorKind: null,
  lastErrorMessage: null,
  consecutiveFailures: 0,
  instagramAccount: { tokenExpiresAt: new Date("2026-10-05T12:00:00.000Z") },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("automation operational state", () => {
  it("distinguishes paused, waiting and active campaigns", () => {
    expect(
      deriveAutomationOperationalState({ ...active, isActive: false }, now).state
    ).toBe("PAUSED");
    expect(
      deriveAutomationOperationalState(
        { ...active, pendingNextReel: true, postId: null },
        now
      ).state
    ).toBe("WAITING_FOR_POST");
    expect(deriveAutomationOperationalState(active, now).state).toBe("ACTIVE");
  });

  it("prioritizes expired credentials and unresolved platform failures", () => {
    expect(
      deriveAutomationOperationalState(
        {
          ...active,
          instagramAccount: {
            tokenExpiresAt: new Date("2026-09-05T11:59:59.000Z"),
          },
        },
        now
      )
    ).toMatchObject({ state: "ERROR", needsAttention: true });

    expect(
      deriveAutomationOperationalState(
        {
          ...active,
          lastRunAt: now,
          lastErrorAt: now,
          lastErrorKind: "AUTHENTICATION",
          lastErrorMessage: "token expired",
          consecutiveFailures: 2,
        },
        now
      )
    ).toMatchObject({
      state: "ERROR",
      reason: "A credencial do Instagram precisa ser renovada.",
      consecutiveFailures: 2,
    });
  });

  it("does not mark the whole campaign broken for a recipient-only failure", () => {
    expect(
      deriveAutomationOperationalState(
        {
          ...active,
          lastRunAt: now,
          lastErrorAt: now,
          lastErrorKind: "DELIVERY",
          lastErrorMessage: "outside of allowed window",
          consecutiveFailures: 1,
        },
        now
      )
    ).toMatchObject({ state: "ACTIVE", needsAttention: false });
  });
});

describe("automation outcome projection", () => {
  it("classifies failures without treating delivery restrictions as systemic", () => {
    expect(classifyAutomationFailure(new Error("No Instagram access token available"))).toBe(
      "CONFIGURATION"
    );
    expect(classifyAutomationFailure(new Error("OAuth token expired"))).toBe(
      "AUTHENTICATION"
    );
    expect(classifyAutomationFailure(new Error("Meta API Error 613: rate limit"))).toBe(
      "RATE_LIMIT"
    );
    expect(classifyAutomationFailure(new Error("outside of allowed window"))).toBe(
      "DELIVERY"
    );
    expect(classifyAutomationFailure(new Error("connection reset"))).toBe(
      "PLATFORM"
    );
  });

  it("redacts credentials and limits stored diagnostics", () => {
    const sanitized = sanitizeAutomationError(
      new Error(
        `request access_token=secret-value {"accessToken":"json-secret"} Bearer another-secret ${"x".repeat(600)}`
      )
    );
    expect(sanitized).not.toContain("secret-value");
    expect(sanitized).not.toContain("json-secret");
    expect(sanitized).not.toContain("another-secret");
    expect(sanitized.length).toBeLessThanOrEqual(500);
  });

  it("persists monotonic failures and resets state after a success", async () => {
    await recordAutomationFailure(
      "automation_1",
      new Error("OAuth token expired"),
      now
    );
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: "automation_1",
        OR: [{ lastRunAt: null }, { lastRunAt: { lte: now } }],
      },
      data: {
        lastRunAt: now,
        lastErrorAt: now,
        lastErrorKind: "AUTHENTICATION",
        lastErrorMessage: "OAuth token expired",
        consecutiveFailures: { increment: 1 },
      },
    });

    await recordAutomationSuccess("automation_1", now);
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: "automation_1",
        OR: [{ lastRunAt: null }, { lastRunAt: { lte: now } }],
      },
      data: {
        lastRunAt: now,
        lastSuccessAt: now,
        lastErrorAt: null,
        lastErrorKind: null,
        lastErrorMessage: null,
        consecutiveFailures: 0,
      },
    });
  });

  it("never lets projection storage failures change worker delivery semantics", async () => {
    mocks.updateMany.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      recordAutomationFailure("automation_1", new Error("Meta failed"), now)
    ).resolves.toBeUndefined();
  });

  it("clears only credential failures for one account inside one workspace", async () => {
    await clearAutomationCredentialFailures(
      { automation: { updateMany: mocks.updateMany } } as never,
      "workspace_1",
      "account_1"
    );

    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: {
        workspaceId: "workspace_1",
        instagramAccountId: "account_1",
        lastErrorKind: { in: ["AUTHENTICATION", "CONFIGURATION"] },
      },
      data: {
        lastErrorAt: null,
        lastErrorKind: null,
        lastErrorMessage: null,
        consecutiveFailures: 0,
      },
    });
  });
});
