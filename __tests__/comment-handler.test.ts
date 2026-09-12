import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { ProcessCommentJob } from "@/lib/queue/client";

const mocks = vi.hoisted(() => ({
  automationFindMany: vi.fn(),
  dmLogFindUnique: vi.fn(),
  dmLogFindFirst: vi.fn(),
  dmLogCreate: vi.fn(),
  dmLogUpdate: vi.fn(),
  dmLogUpsert: vi.fn(),
  dmLogUpdateMany: vi.fn(),
  decryptToken: vi.fn(),
  matchKeywords: vi.fn(),
  reserveDMSlot: vi.fn(),
  reserveWorkspaceDMSend: vi.fn(),
  releaseWorkspaceDMReservation: vi.fn(),
  recordAutomationSuccess: vi.fn(),
  recordAutomationFailure: vi.fn(),
  sendCommentReply: vi.fn(),
  sendPrivateReply: vi.fn(),
  sendPrivateReplyWithButton: vi.fn(),
  sendPrivateReplyWithLinkButton: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    automation: { findMany: mocks.automationFindMany },
    dmLog: {
      findUnique: mocks.dmLogFindUnique,
      findFirst: mocks.dmLogFindFirst,
      create: mocks.dmLogCreate,
      update: mocks.dmLogUpdate,
      upsert: mocks.dmLogUpsert,
      updateMany: mocks.dmLogUpdateMany,
    },
  },
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mocks.decryptToken }));
vi.mock("@/lib/utils/keyword-matcher", () => ({
  matchKeywords: mocks.matchKeywords,
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: mocks.reserveDMSlot,
}));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: mocks.reserveWorkspaceDMSend,
  releaseWorkspaceDMReservation: mocks.releaseWorkspaceDMReservation,
}));
vi.mock("@/lib/automations/operational-state", () => ({
  recordAutomationSuccess: mocks.recordAutomationSuccess,
  recordAutomationFailure: mocks.recordAutomationFailure,
}));
vi.mock("@/lib/meta/client", () => ({
  getUserFollowStatus: vi.fn(),
  sendCommentReply: mocks.sendCommentReply,
  sendPrivateReply: mocks.sendPrivateReply,
  sendPrivateReplyWithButton: mocks.sendPrivateReplyWithButton,
  sendPrivateReplyWithLinkButton: mocks.sendPrivateReplyWithLinkButton,
}));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: mocks.queueAdd }),
}));
vi.mock("@/lib/queue/delivery", () => ({
  buildInlineLinkFallback: vi.fn(),
  buildWorkerLinkButtons: vi.fn(),
  formatWorkerError: (error: unknown) =>
    error instanceof Error ? error.message : "Unknown error",
  isTemplateRejection: vi.fn(() => false),
}));

import { processComment } from "@/lib/queue/handlers/comment";

const periodStart = new Date("2026-09-01T00:00:00.000Z");
const configuredAutomation = {
  id: "automation_1",
  workspaceId: "workspace_1",
  instagramAccountId: "account_row_1",
  keywords: ["preço"],
  wholeWordMatch: true,
  matchAnyWord: false,
  publicReplyEnabled: false,
  publicReplyMessage: null,
  publicReplyMessages: [],
  openingDmEnabled: false,
  openingDmMessage: null,
  openingDmButtonLabel: null,
  requireFollow: false,
  followPromptMessage: null,
  followPromptButtonLabel: null,
  dmMessage: "Oi, {username}!",
  linkButtonLabel: null,
  instagramAccount: {
    instagramId: "business_1",
    accessToken: "encrypted-token",
  },
  workspace: { id: "workspace_1" },
  trackedLinks: [],
};

function job(overrides: Partial<ProcessCommentJob> = {}) {
  return {
    data: {
      instagramAccountId: "business_1",
      commentId: "comment_1",
      commentText: "Qual é o preço?",
      commenterId: "person_1",
      commenterName: "Bia",
      mediaId: "ad_media_1",
      originalMediaId: "post_1",
      ...overrides,
    },
    attemptsMade: 0,
  } as Job<ProcessCommentJob>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.automationFindMany.mockResolvedValue([configuredAutomation]);
  mocks.dmLogFindUnique.mockResolvedValue(null);
  mocks.dmLogFindFirst.mockResolvedValue(null);
  mocks.dmLogCreate.mockResolvedValue({});
  mocks.dmLogUpdate.mockResolvedValue({});
  mocks.decryptToken.mockReturnValue("plain-token");
  mocks.matchKeywords.mockReturnValue({ matched: true, matchedKeyword: "preço" });
  mocks.reserveWorkspaceDMSend.mockResolvedValue({
    allowed: true,
    periodStart,
  });
  mocks.reserveDMSlot.mockResolvedValue({ allowed: true });
  mocks.sendPrivateReply.mockResolvedValue({ message_id: "sent_1" });
});

describe("comment queue handler", () => {
  it("matches the ad media, original post and any-post within the event account", async () => {
    await processComment(job());

    expect(mocks.automationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { postId: "ad_media_1" },
            { postId: "post_1" },
            { matchAnyPost: true },
          ],
          instagramAccount: { instagramId: "business_1" },
        }),
      })
    );
  });

  it("does not replay a private reply after an ambiguous delivery attempt", async () => {
    mocks.dmLogFindUnique.mockResolvedValue({
      status: "FAILED",
      deliveryAttemptedAt: new Date(),
      publicReplySentAt: null,
    });

    await processComment(job());

    expect(mocks.decryptToken).not.toHaveBeenCalled();
    expect(mocks.reserveWorkspaceDMSend).not.toHaveBeenCalled();
    expect(mocks.sendPrivateReply).not.toHaveBeenCalled();
  });

  it("skips the DM when another campaign used the one private reply", async () => {
    mocks.dmLogFindFirst.mockResolvedValue({
      automation: { name: "Campanha anterior" },
    });

    await processComment(job());

    expect(mocks.dmLogUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED_DEDUP",
          errorMessage: expect.stringContaining("Campanha anterior"),
        }),
      })
    );
    expect(mocks.reserveWorkspaceDMSend).not.toHaveBeenCalled();
    expect(mocks.sendPrivateReply).not.toHaveBeenCalled();
  });

  it("releases monthly usage and schedules a deterministic rate-limit retry", async () => {
    mocks.reserveDMSlot.mockResolvedValue({
      allowed: false,
      shouldSkip: false,
      shouldRequeue: true,
      requeueDelayMs: 15_000,
    });

    await processComment(job({ requeueAttempt: 1 }));

    expect(mocks.releaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_1",
      periodStart
    );
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "process-comment",
      expect.objectContaining({ requeueAttempt: 2 }),
      {
        delay: 15_000,
        jobId: "comment_business_1_comment_1_retry_2",
      }
    );
    expect(mocks.sendPrivateReply).not.toHaveBeenCalled();
  });

  it("marks the attempt before sending and releases usage on failure", async () => {
    const error = new Error("Meta unavailable");
    mocks.sendPrivateReply.mockRejectedValue(error);

    await expect(processComment(job())).rejects.toBe(error);

    expect(mocks.dmLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { deliveryAttemptedAt: expect.any(Date) },
      })
    );
    expect(mocks.releaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_1",
      periodStart
    );
    expect(mocks.dmLogUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
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

  it("parks the campaign in a delayed job when a human delay is configured", async () => {
    mocks.automationFindMany.mockResolvedValue([
      { ...configuredAutomation, humanDelayMinSeconds: 20, humanDelayMaxSeconds: 90 },
    ]);

    await processComment(job());

    // The row exists (pending) so the comment is visible while it waits…
    expect(mocks.dmLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING", commentId: "comment_1" }),
      })
    );
    // …the work is re-enqueued for this campaign only, inside the window…
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1);
    const [name, data, options] = mocks.queueAdd.mock.calls[0];
    expect(name).toBe("process-comment");
    expect(data).toMatchObject({
      automationId: "automation_1",
      matchedKeyword: "preço",
      humanDelayApplied: true,
      commentId: "comment_1",
    });
    expect(options.delay).toBeGreaterThanOrEqual(20_000);
    expect(options.delay).toBeLessThanOrEqual(90_000);
    expect(options.jobId).toBe("comment_business_1_comment_1_automation_1_delayed");
    // …and nothing reaches Meta yet.
    expect(mocks.sendPrivateReply).not.toHaveBeenCalled();
    expect(mocks.reserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("sends without waiting again once the delayed job runs", async () => {
    mocks.automationFindMany.mockResolvedValue([
      { ...configuredAutomation, humanDelayMinSeconds: 20, humanDelayMaxSeconds: 90 },
    ]);
    mocks.dmLogFindUnique.mockResolvedValue({ status: "PENDING", publicReplySentAt: null });

    await processComment(
      job({ automationId: "automation_1", matchedKeyword: "preço", humanDelayApplied: true })
    );

    expect(mocks.queueAdd).not.toHaveBeenCalled();
    expect(mocks.sendPrivateReply).toHaveBeenCalledTimes(1);
  });

  it("rotates DM variations and expands spintax before sending", async () => {
    mocks.automationFindMany.mockResolvedValue([
      {
        ...configuredAutomation,
        dmMessage: "{Oi|Olá} {username}!",
        dmMessages: [],
      },
    ]);

    await processComment(job());

    const sent = mocks.sendPrivateReply.mock.calls[0][3] as string;
    expect(["Oi Bia!", "Olá Bia!"]).toContain(sent);
  });

  it("picks the public reply from the variations list", async () => {
    mocks.sendCommentReply.mockResolvedValue({});
    mocks.automationFindMany.mockResolvedValue([
      {
        ...configuredAutomation,
        publicReplyEnabled: true,
        publicReplyMessages: ["Te chamei no direct!", "Olha a DM 📩"],
      },
    ]);

    await processComment(job());

    const reply = mocks.sendCommentReply.mock.calls[0][2] as string;
    expect(["Te chamei no direct!", "Olha a DM 📩"]).toContain(reply);
  });
});
