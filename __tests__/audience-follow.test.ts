import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserFollowProfile: vi.fn(),
  contactUpsert: vi.fn(),
  queueAdd: vi.fn(),
}));
vi.mock("@/lib/meta/client", () => ({
  getUserFollowProfile: mocks.getUserFollowProfile,
}));
vi.mock("@/lib/db/client", () => ({
  prisma: { contact: { upsert: mocks.contactUpsert } },
}));
vi.mock("@/lib/queue/client", () => ({
  POSTBACK_JOB_NAME: "process-postback",
  getDMQueue: () => ({ add: mocks.queueAdd }),
}));

import {
  checkAndRecordFollowStatus,
  pickAudienceDmTemplate,
} from "@/lib/audience/follow-status";
import {
  followRecheckDelaysMinutes,
  scheduleFollowRechecks,
} from "@/lib/audience/follow-recheck";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.contactUpsert.mockResolvedValue({});
});

describe("follow status", () => {
  it("verifies with Meta and stores both directions on the contact", async () => {
    mocks.getUserFollowProfile.mockResolvedValue({
      follows: true,
      followedBy: false,
      username: "ana",
    });

    const result = await checkAndRecordFollowStatus({
      accessToken: "t",
      workspaceId: "ws",
      instagramAccountId: "acct_row",
      userId: "user_1",
    });

    expect(result).toEqual({ follows: true, followedBy: false });
    expect(mocks.contactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId_instagramAccountId_instagramScopedId: {
            workspaceId: "ws",
            instagramAccountId: "acct_row",
            instagramScopedId: "user_1",
          },
        },
        create: expect.objectContaining({ username: "ana", followsAccount: true, followedByAccount: false }),
        update: expect.objectContaining({ followsAccount: true, followedByAccount: false }),
      })
    );
  });

  it("does not touch the contact when nothing could be verified, and never throws", async () => {
    mocks.getUserFollowProfile.mockResolvedValue({ follows: null, followedBy: null });
    await expect(
      checkAndRecordFollowStatus({ accessToken: "t", workspaceId: "ws", instagramAccountId: "a", userId: "u" })
    ).resolves.toEqual({ follows: null, followedBy: null });
    expect(mocks.contactUpsert).not.toHaveBeenCalled();

    mocks.getUserFollowProfile.mockResolvedValue({ follows: false, followedBy: null });
    mocks.contactUpsert.mockRejectedValue(new Error("db down"));
    await expect(
      checkAndRecordFollowStatus({ accessToken: "t", workspaceId: "ws", instagramAccountId: "a", userId: "u" })
    ).resolves.toEqual({ follows: false, followedBy: null });
  });

  it("picks audience wording only when enabled, filled in and verified", () => {
    const automation = {
      dmMessage: "padrão {link}",
      audienceDmEnabled: true,
      followerDmMessage: " obrigado por seguir {link} ",
      nonFollowerDmMessage: "",
    };
    expect(pickAudienceDmTemplate(automation, true)).toBe("obrigado por seguir {link}");
    expect(pickAudienceDmTemplate(automation, false)).toBeNull();
    expect(pickAudienceDmTemplate(automation, null)).toBeNull();
    expect(pickAudienceDmTemplate({ ...automation, audienceDmEnabled: false }, true)).toBeNull();
    expect(
      pickAudienceDmTemplate({ ...automation, nonFollowerDmMessage: "segue aí {link}" }, false)
    ).toBe("segue aí {link}");
  });
});

describe("follow re-check scheduling", () => {
  it("defaults to 10 and 60 minutes and accepts an env override", () => {
    expect(followRecheckDelaysMinutes({})).toEqual([10, 60]);
    expect(followRecheckDelaysMinutes({ FOLLOW_RECHECK_MINUTES: "30, 5,5, abc, 0" })).toEqual([5, 30]);
    expect(followRecheckDelaysMinutes({ FOLLOW_RECHECK_MINUTES: "nope" })).toEqual([10, 60]);
  });

  it("enqueues one silent followcheck job per delay with a stable id", async () => {
    await scheduleFollowRechecks({ instagramAccountId: "ig_1", userId: "user_1", automationId: "auto_1" });
    expect(mocks.queueAdd).toHaveBeenCalledTimes(2);
    expect(mocks.queueAdd).toHaveBeenNthCalledWith(
      1,
      "process-postback",
      { instagramAccountId: "ig_1", userId: "user_1", payload: "followcheck:auto_1", autoRecheck: true },
      { delay: 600_000, jobId: "followrecheck_auto_1_user_1_10" }
    );
    expect(mocks.queueAdd).toHaveBeenNthCalledWith(
      2,
      "process-postback",
      expect.objectContaining({ autoRecheck: true }),
      { delay: 3_600_000, jobId: "followrecheck_auto_1_user_1_60" }
    );
  });
});
