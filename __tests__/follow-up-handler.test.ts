import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { ProcessFollowUpJob } from "@/lib/queue/client";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  decryptToken: vi.fn(),
  sendDirectMessage: vi.fn(),
  recordAutomationSuccess: vi.fn(),
  recordAutomationFailure: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: { automation: { findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mocks.decryptToken }));
vi.mock("@/lib/meta/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/meta/client")>(
    "@/lib/meta/client"
  );
  return { ...actual, sendDirectMessage: mocks.sendDirectMessage };
});
vi.mock("@/lib/automations/operational-state", () => ({
  recordAutomationSuccess: mocks.recordAutomationSuccess,
  recordAutomationFailure: mocks.recordAutomationFailure,
}));

import { processFollowUp } from "@/lib/queue/handlers/follow-up";

const configuredAutomation = {
  id: "automation_1",
  followUpEnabled: true,
  followUpMessage: "Obrigada, {username}!",
  instagramAccount: {
    instagramId: "business_1",
    accessToken: "encrypted-token",
  },
};

function job(
  overrides: Partial<ProcessFollowUpJob> = {}
): Job<ProcessFollowUpJob> {
  return {
    data: {
      instagramAccountId: "business_1",
      userId: "person_1",
      automationId: "automation_1",
      commenterName: "Bia",
      ...overrides,
    },
  } as Job<ProcessFollowUpJob>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue(configuredAutomation);
  mocks.decryptToken.mockReturnValue("plain-token");
  mocks.sendDirectMessage.mockResolvedValue({ message_id: "message_1" });
  mocks.recordAutomationSuccess.mockResolvedValue(undefined);
  mocks.recordAutomationFailure.mockResolvedValue(undefined);
});

describe("follow-up queue handler", () => {
  it("repeats the external account boundary before sending", async () => {
    await processFollowUp(job({ instagramAccountId: "another-business" }));

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "automation_1", isActive: true },
      include: { instagramAccount: true },
    });
    expect(mocks.decryptToken).not.toHaveBeenCalled();
    expect(mocks.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("projects a configuration failure when the account has no token", async () => {
    mocks.findFirst.mockResolvedValue({
      ...configuredAutomation,
      instagramAccount: {
        ...configuredAutomation.instagramAccount,
        accessToken: null,
      },
    });

    await processFollowUp(job());

    expect(mocks.recordAutomationFailure).toHaveBeenCalledWith(
      "automation_1",
      expect.objectContaining({
        message: "A conta do Instagram não possui uma credencial de acesso",
      })
    );
    expect(mocks.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("delivers a personalized follow-up and projects success", async () => {
    await processFollowUp(job());

    expect(mocks.sendDirectMessage).toHaveBeenCalledWith(
      "plain-token",
      "business_1",
      "person_1",
      "Obrigada, Bia!"
    );
    expect(mocks.recordAutomationSuccess).toHaveBeenCalledWith("automation_1");
    expect(mocks.recordAutomationFailure).not.toHaveBeenCalled();
  });

  it("records a delivery failure but keeps the scheduled handler best-effort", async () => {
    const error = new Error("outside of allowed window");
    mocks.sendDirectMessage.mockRejectedValue(error);

    await expect(processFollowUp(job())).resolves.toBeUndefined();

    expect(mocks.recordAutomationFailure).toHaveBeenCalledWith(
      "automation_1",
      error
    );
    expect(mocks.recordAutomationSuccess).not.toHaveBeenCalled();
  });
});
