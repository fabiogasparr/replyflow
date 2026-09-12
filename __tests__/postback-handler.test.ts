import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { ProcessPostbackJob } from "@/lib/queue/client";

const mocks = vi.hoisted(() => ({
  automationFindFirst: vi.fn(),
  dmLogFindUnique: vi.fn(),
  dmLogFindFirst: vi.fn(),
  dmLogUpsert: vi.fn(),
  decryptToken: vi.fn(),
  getUserFollowStatus: vi.fn(),
  sendDirectMessageWithButton: vi.fn(),
  reserveWorkspaceDMSend: vi.fn(),
  releaseWorkspaceDMReservation: vi.fn(),
  recordAutomationSuccess: vi.fn(),
  recordAutomationFailure: vi.fn(),
  sendRevealDirectMessage: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    automation: { findFirst: mocks.automationFindFirst },
    dmLog: {
      findUnique: mocks.dmLogFindUnique,
      findFirst: mocks.dmLogFindFirst,
      upsert: mocks.dmLogUpsert,
    },
  },
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mocks.decryptToken }));
vi.mock("@/lib/meta/client", () => ({
  getUserFollowStatus: mocks.getUserFollowStatus,
  sendDirectMessageWithButton: mocks.sendDirectMessageWithButton,
}));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: mocks.reserveWorkspaceDMSend,
  releaseWorkspaceDMReservation: mocks.releaseWorkspaceDMReservation,
}));
vi.mock("@/lib/automations/operational-state", () => ({
  recordAutomationSuccess: mocks.recordAutomationSuccess,
  recordAutomationFailure: mocks.recordAutomationFailure,
}));
vi.mock("@/lib/queue/client", () => ({
  FOLLOWUP_JOB_NAME: "process-followup",
  getDMQueue: () => ({ add: mocks.queueAdd }),
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: vi.fn(async () => ({
    allowed: true,
    currentCount: 1,
    remainingDMs: 749,
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
    reserved: true,
  })),
}));
vi.mock("@/lib/queue/delivery", () => ({
  formatWorkerError: (error: unknown) =>
    error instanceof Error ? error.message : "Unknown error",
  sendRevealDirectMessage: mocks.sendRevealDirectMessage,
}));

import { processPostback } from "@/lib/queue/handlers/postback";

const periodStart = new Date("2026-09-01T00:00:00.000Z");
const configuredAutomation = {
  id: "automation_1",
  workspaceId: "workspace_1",
  instagramAccountId: "account_row_1",
  requireFollow: false,
  followPromptMessage: null,
  followPromptButtonLabel: null,
  followUpEnabled: true,
  followUpMessage: "Obrigada!",
  followUpDelayMinutes: 5,
  dmMessage: "Aqui está seu link",
  linkButtonLabel: null,
  instagramAccount: {
    instagramId: "business_1",
    accessToken: "encrypted-token",
  },
  workspace: { id: "workspace_1" },
  trackedLinks: [],
};

function job(overrides: Partial<ProcessPostbackJob> = {}) {
  return {
    data: {
      instagramAccountId: "business_1",
      userId: "person_1",
      payload: "reveal:automation_1",
      ...overrides,
    },
  } as Job<ProcessPostbackJob>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.automationFindFirst.mockResolvedValue(configuredAutomation);
  mocks.dmLogFindUnique.mockResolvedValue(null);
  mocks.dmLogFindFirst.mockResolvedValue({ commenterName: "Bia" });
  mocks.decryptToken.mockReturnValue("plain-token");
  mocks.reserveWorkspaceDMSend.mockResolvedValue({
    allowed: true,
    periodStart,
  });
  mocks.sendRevealDirectMessage.mockResolvedValue(undefined);
  mocks.queueAdd.mockResolvedValue(undefined);
});

describe("postback queue handler", () => {
  it("ignores payloads outside the supported postback protocol", async () => {
    await processPostback(job({ payload: "unknown:automation_1" }));

    expect(mocks.automationFindFirst).not.toHaveBeenCalled();
  });

  it("repeats the external account boundary before opening the token", async () => {
    await processPostback(job({ instagramAccountId: "another-business" }));

    expect(mocks.decryptToken).not.toHaveBeenCalled();
    expect(mocks.sendRevealDirectMessage).not.toHaveBeenCalled();
  });

  it("delivers, records success and schedules one deterministic follow-up", async () => {
    await processPostback(job());

    expect(mocks.sendRevealDirectMessage).toHaveBeenCalledWith(
      "plain-token",
      configuredAutomation,
      "person_1",
      "Bia",
      "postback"
    );
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "process-followup",
      expect.objectContaining({ automationId: "automation_1" }),
      { delay: 300_000, jobId: "followup_automation_1_person_1" }
    );
    expect(mocks.dmLogUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "SENT" }),
      })
    );
    expect(mocks.recordAutomationSuccess).toHaveBeenCalledWith("automation_1");
  });

  it("does not turn a speculative read fallback rejection into a retry", async () => {
    mocks.sendRevealDirectMessage.mockRejectedValue(
      new Error("outside of allowed window")
    );

    await expect(processPostback(job({ fallback: true }))).resolves.toBeUndefined();

    expect(mocks.releaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_1",
      periodStart
    );
    expect(mocks.dmLogUpsert).not.toHaveBeenCalled();
    expect(mocks.recordAutomationFailure).not.toHaveBeenCalled();
  });

  it("records and rethrows a real button delivery failure", async () => {
    const error = new Error("Meta unavailable");
    mocks.sendRevealDirectMessage.mockRejectedValue(error);

    await expect(processPostback(job())).rejects.toBe(error);

    expect(mocks.dmLogUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: "FAILED",
          errorMessage: "Meta unavailable",
        }),
      })
    );
    expect(mocks.recordAutomationFailure).toHaveBeenCalledWith(
      "automation_1",
      error
    );
  });
});
