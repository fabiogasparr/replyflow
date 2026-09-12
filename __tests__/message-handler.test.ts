import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { ProcessMessageJob } from "@/lib/queue/client";

const mocks = vi.hoisted(() => ({
  automationFindMany: vi.fn(),
  dmLogFindUnique: vi.fn(),
  dmLogFindFirst: vi.fn(),
  dmLogUpsert: vi.fn(),
  dmLogUpdateMany: vi.fn(),
  decryptToken: vi.fn(),
  matchKeywords: vi.fn(),
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
    automation: { findMany: mocks.automationFindMany },
    dmLog: {
      findUnique: mocks.dmLogFindUnique,
      findFirst: mocks.dmLogFindFirst,
      upsert: mocks.dmLogUpsert,
      updateMany: mocks.dmLogUpdateMany,
    },
  },
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mocks.decryptToken }));
vi.mock("@/lib/utils/keyword-matcher", () => ({
  matchKeywords: mocks.matchKeywords,
}));
vi.mock("@/lib/meta/client", () => ({
  getUserFollowStatus: mocks.getUserFollowStatus,
  getUserFollowProfile: async (token: string, id: string) => ({
    follows: await mocks.getUserFollowStatus(token, id),
    followedBy: null,
  }),
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
  POSTBACK_JOB_NAME: "process-postback",
  MESSAGE_JOB_NAME: "process-message",
getDMQueue: () => ({ add: mocks.queueAdd }),
}));
const rateLimiter = vi.hoisted(() => ({
  reserveDMSlot: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: rateLimiter.reserveDMSlot,
}));
vi.mock("@/lib/queue/delivery", () => ({
  formatWorkerError: (error: unknown) =>
    error instanceof Error ? error.message : "Unknown error",
  sendRevealDirectMessage: mocks.sendRevealDirectMessage,
}));

import { processMessage } from "@/lib/queue/handlers/message";

const periodStart = new Date("2026-09-01T00:00:00.000Z");
const configuredAutomation = {
  id: "automation_1",
  workspaceId: "workspace_1",
  instagramAccountId: "account_row_1",
  dmTriggerEnabled: true,
  matchAnyWord: false,
  keywords: ["preço"],
  wholeWordMatch: true,
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

function job(overrides: Partial<ProcessMessageJob> = {}) {
  return {
    data: {
      instagramAccountId: "business_1",
      senderId: "person_1",
      messageId: "message_1",
      messageText: "Qual é o preço?",
      ...overrides,
    },
    attemptsMade: 0,
  } as Job<ProcessMessageJob>;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimiter.reserveDMSlot.mockResolvedValue({
    allowed: true,
    currentCount: 1,
    remainingDMs: 749,
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
    reserved: true,
  });
  mocks.automationFindMany.mockResolvedValue([configuredAutomation]);
  mocks.dmLogFindUnique.mockResolvedValue(null);
  mocks.dmLogFindFirst.mockResolvedValue({ commenterName: "Bia" });
  mocks.decryptToken.mockReturnValue("plain-token");
  mocks.matchKeywords.mockReturnValue({ matched: true, matchedKeyword: "preço" });
  mocks.getUserFollowStatus.mockResolvedValue(true);
  mocks.reserveWorkspaceDMSend.mockResolvedValue({
    allowed: true,
    periodStart,
  });
  mocks.sendRevealDirectMessage.mockResolvedValue(undefined);
  mocks.queueAdd.mockResolvedValue(undefined);
});

describe("inbound message queue handler", () => {
  it("limits eligible campaigns to the event's Instagram account", async () => {
    await processMessage(job());

    expect(mocks.automationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dmTriggerEnabled: true,
          isActive: true,
          instagramAccount: { instagramId: "business_1" },
        }),
      })
    );
  });

  it("does not replay an inbound message with an ambiguous prior attempt", async () => {
    mocks.dmLogFindUnique.mockResolvedValue({
      status: "FAILED",
      deliveryAttemptedAt: new Date(),
    });

    await processMessage(job());

    expect(mocks.decryptToken).not.toHaveBeenCalled();
    expect(mocks.reserveWorkspaceDMSend).not.toHaveBeenCalled();
    expect(mocks.sendRevealDirectMessage).not.toHaveBeenCalled();
  });

  it("keeps the follow gate closed when the status is unverifiable", async () => {
    mocks.automationFindMany.mockResolvedValue([
      { ...configuredAutomation, requireFollow: true },
    ]);
    mocks.getUserFollowStatus.mockResolvedValue(null);

    await processMessage(job());

    expect(mocks.sendDirectMessageWithButton).toHaveBeenCalledWith(
      "plain-token",
      "business_1",
      "person_1",
      expect.any(String),
      "Já estou seguindo",
      "followcheck:automation_1"
    );
    expect(mocks.sendRevealDirectMessage).not.toHaveBeenCalled();
    // No follow-up is scheduled (no link went out) — only the automatic
    // follow re-checks that deliver the link once the person follows.
    expect(
      mocks.queueAdd.mock.calls.filter(([name]) => name === "process-followup")
    ).toHaveLength(0);
    expect(
      mocks.queueAdd.mock.calls.filter(
        ([, data]) => (data as { autoRecheck?: boolean }).autoRecheck
      )
    ).toHaveLength(2);
  });

  it("records the attempt, delivers the reveal and schedules the follow-up", async () => {
    await processMessage(job());

    expect(mocks.dmLogUpsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({
          commentId: "dm:message_1",
          triggerType: "MESSAGE",
          status: "PENDING",
          deliveryAttemptedAt: expect.any(Date),
        }),
      })
    );
    expect(mocks.sendRevealDirectMessage).toHaveBeenCalledWith(
      "plain-token",
      configuredAutomation,
      "person_1",
      "Bia",
      "message trigger"
    );
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "process-followup",
      expect.objectContaining({ automationId: "automation_1" }),
      { delay: 300_000, jobId: "followup_automation_1_person_1" }
    );
    expect(mocks.recordAutomationSuccess).toHaveBeenCalledWith("automation_1");
  });

  it("releases reserved usage, records and rethrows a delivery failure", async () => {
    const error = new Error("Meta unavailable");
    mocks.sendRevealDirectMessage.mockRejectedValue(error);

    await expect(processMessage(job())).rejects.toBe(error);

    expect(mocks.releaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_1",
      periodStart
    );
    expect(mocks.dmLogUpsert).toHaveBeenLastCalledWith(
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

  it("applies the per-account hourly ceiling to keyword DMs", async () => {
    rateLimiter.reserveDMSlot.mockResolvedValue({
      allowed: false,
      currentCount: 750,
      remainingDMs: 0,
      shouldRequeue: true,
      requeueDelayMs: 1_800_000,
      shouldSkip: false,
      reserved: false,
    });

    await processMessage(job());

    expect(mocks.sendRevealDirectMessage).not.toHaveBeenCalled();
    expect(mocks.releaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_1",
      periodStart
    );
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "process-message",
      expect.objectContaining({
        automationId: "automation_1",
        requeueAttempt: 1,
        humanDelayApplied: true,
      }),
      expect.objectContaining({ delay: 1_800_000 })
    );
  });

  it("defers a keyword DM by the campaign's human delay", async () => {
    mocks.automationFindMany.mockResolvedValue([
      { ...configuredAutomation, humanDelayMinSeconds: 5, humanDelayMaxSeconds: 5 },
    ]);

    await processMessage(job());

    expect(mocks.sendRevealDirectMessage).not.toHaveBeenCalled();
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "process-message",
      expect.objectContaining({ automationId: "automation_1", humanDelayApplied: true }),
      expect.objectContaining({ delay: 5000 })
    );
  });

  it("fires story-mention campaigns without any keyword", async () => {
    mocks.automationFindMany.mockResolvedValue([
      { ...configuredAutomation, dmTriggerEnabled: false, storyTriggerEnabled: true },
    ]);
    mocks.matchKeywords.mockReturnValue({ matched: false, matchedKeyword: null });

    await processMessage(job({ kind: "story_mention", messageText: "", messageId: "mid_mention" }));

    expect(mocks.automationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ storyTriggerEnabled: true }) })
    );
    expect(mocks.matchKeywords).not.toHaveBeenCalled();
    expect(mocks.sendRevealDirectMessage).toHaveBeenCalledTimes(1);
    expect(mocks.dmLogUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          triggerType: "STORY",
          commentText: "Menção em um story",
        }),
      })
    );
  });

  it("matches story replies against keywords for story and DM campaigns alike", async () => {
    mocks.matchKeywords.mockReturnValue({ matched: false, matchedKeyword: null });
    await processMessage(job({ kind: "story_reply", messageText: "oi", messageId: "mid_s" }));
    expect(mocks.automationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ storyTriggerEnabled: true }, { dmTriggerEnabled: true }],
        }),
      })
    );
    expect(mocks.sendRevealDirectMessage).not.toHaveBeenCalled();
  });

  it("routes ig.me referrals to the campaign owning the code", async () => {
    await processMessage(job({ kind: "referral", referralCode: "guia26", messageText: "", messageId: "mid_r" }));
    expect(mocks.automationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ referralTriggerEnabled: true, referralCode: "guia26" }),
      })
    );
    expect(mocks.sendRevealDirectMessage).toHaveBeenCalledTimes(1);
    expect(mocks.dmLogUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ triggerType: "REFERRAL" }) })
    );
  });
});
