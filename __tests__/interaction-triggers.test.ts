import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseCommentEvents,
  parseInteractionEvents,
  parseMessageEvents,
} from "@/lib/meta/webhook";
import { buildDmRetryJob } from "@/lib/dm-retry";
import { buildReferralLink, generateReferralCode } from "@/lib/automations/referral";

function payload(messaging: unknown[]) {
  return {
    object: "instagram",
    entry: [{ id: "ig_1", time: 1700000000, messaging }],
  } as Parameters<typeof parseInteractionEvents>[0];
}

describe("interaction webhook parsing", () => {
  it("recognises a story reply and keeps it out of the plain-DM parser", () => {
    const p = payload([
      {
        sender: { id: "user_1" },
        recipient: { id: "ig_1" },
        message: {
          mid: "mid_story",
          text: "quero o guia",
          reply_to: { story: { id: "story_9", url: "https://cdn/x" } },
        },
      },
    ]);
    expect(parseInteractionEvents(p)).toEqual([
      {
        kind: "story_reply",
        instagramAccountId: "ig_1",
        messageId: "mid_story",
        messageText: "quero o guia",
        senderId: "user_1",
        storyId: "story_9",
      },
    ]);
    expect(parseMessageEvents(p)).toHaveLength(0);
  });

  it("recognises a story mention with no text", () => {
    const p = payload([
      {
        sender: { id: "user_1" },
        recipient: { id: "ig_1" },
        message: { mid: "mid_mention", attachments: [{ type: "story_mention", payload: { url: "x" } }] },
      },
    ]);
    expect(parseInteractionEvents(p)).toEqual([
      {
        kind: "story_mention",
        instagramAccountId: "ig_1",
        messageId: "mid_mention",
        messageText: "",
        senderId: "user_1",
      },
    ]);
  });

  it("recognises ig.me referrals with or without a first message", () => {
    const p = payload([
      {
        sender: { id: "user_1" },
        recipient: { id: "ig_1" },
        referral: { ref: "guia2026", source: "SHORTLINK", type: "OPEN_THREAD" },
      },
      {
        sender: { id: "user_2" },
        recipient: { id: "ig_1" },
        message: { mid: "mid_ref", text: "oi", referral: { ref: "guia2026", source: "SHORTLINK" } },
      },
    ]);
    const events = parseInteractionEvents(p);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "referral", referralCode: "guia2026", senderId: "user_1" });
    expect(events[0].messageId).toMatch(/^referral_ig_1_user_1_/);
    expect(events[1]).toMatchObject({ kind: "referral", referralCode: "guia2026", messageId: "mid_ref", messageText: "oi" });
    expect(parseMessageEvents(p)).toHaveLength(0);
  });

  it("drops echoes, the account's own actions and ordinary DMs", () => {
    const p = payload([
      { sender: { id: "ig_1" }, recipient: { id: "user_1" }, message: { mid: "m1", text: "x", is_echo: true, reply_to: { story: { id: "s" } } } },
      { sender: { id: "user_1" }, recipient: { id: "ig_1" }, message: { mid: "m2", text: "só uma dm" } },
    ]);
    expect(parseInteractionEvents(p)).toHaveLength(0);
    expect(parseMessageEvents(p)).toHaveLength(1);
  });

  it("treats live-video comments like post comments", () => {
    const events = parseCommentEvents({
      object: "instagram",
      entry: [
        {
          id: "ig_1",
          time: 1,
          changes: [
            {
              field: "live_comments",
              value: { id: "c1", text: "link", from: { id: "user_1", username: "ana" }, media: { id: "live_1" } },
            },
          ],
        },
      ],
    } as Parameters<typeof parseCommentEvents>[0]);
    expect(events).toEqual([
      expect.objectContaining({ commentId: "c1", mediaId: "live_1", commenterId: "user_1" }),
    ]);
  });
});

describe("referral links", () => {
  it("mints unambiguous codes and builds the ig.me link", () => {
    const code = generateReferralCode();
    expect(code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
    expect(buildReferralLink("kz3solucoes", "abc23456")).toBe(
      "https://ig.me/m/kz3solucoes?ref=abc23456"
    );
  });
});

describe("retrying interaction-triggered sends", () => {
  it("rebuilds story, referral and ice-breaker jobs with their kind", () => {
    const base = {
      id: "log_1",
      status: "FAILED" as const,
      automationId: "auto_1",
      commentId: "dm:mid_1",
      commenterId: "user_1",
      commentText: "",
      commenterName: null,
      matchedKeyword: null,
      triggerType: "STORY" as const,
      sourceEventId: "mid_1",
      sourceMediaId: null,
      originalMediaId: null,
      deliveryAttemptedAt: null,
      manualRetryCount: 0,
      lastManualRetryAt: null,
      automation: { isActive: true },
      instagramAccount: { instagramId: "ig_1", tokenExpiresAt: null },
    };
    expect(buildDmRetryJob(base).data).toMatchObject({ kind: "story_reply", approvedByOperator: true });
    expect(buildDmRetryJob({ ...base, triggerType: "REFERRAL" }).data).toMatchObject({ kind: "referral" });
    expect(buildDmRetryJob({ ...base, triggerType: "ICE_BREAKER" }).data).toMatchObject({ kind: "ice_breaker" });
    expect(buildDmRetryJob({ ...base, triggerType: "MESSAGE" }).data).not.toHaveProperty("kind");
  });
});

describe("ice breaker sync", () => {
  const mocks = vi.hoisted(() => ({
    accountFindUnique: vi.fn(),
    operationalEventCreate: vi.fn(),
    setIceBreakers: vi.fn(),
    clearIceBreakers: vi.fn(),
  }));
  vi.mock("@/lib/db/client", () => ({
    prisma: {
      instagramAccount: { findUnique: mocks.accountFindUnique },
      operationalEvent: { create: mocks.operationalEventCreate },
    },
  }));
  vi.mock("@/lib/meta/client", () => ({
    setInstagramIceBreakers: mocks.setIceBreakers,
    clearInstagramIceBreakers: mocks.clearIceBreakers,
  }));
  vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "token" }));

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setIceBreakers.mockResolvedValue({ result: "success" });
    mocks.clearIceBreakers.mockResolvedValue({ result: "success" });
    mocks.operationalEventCreate.mockResolvedValue({});
  });

  it("publishes up to four questions in campaign order, or clears them", async () => {
    const { syncAccountIceBreakers } = await import("@/lib/meta/ice-breakers");
    mocks.accountFindUnique.mockResolvedValue({
      id: "acct",
      workspaceId: "ws",
      username: "marca",
      accessToken: "enc",
      automations: [1, 2, 3, 4, 5].map((n) => ({ id: `a${n}`, iceBreakerQuestion: `Pergunta ${n}` })),
    });
    await expect(syncAccountIceBreakers("acct")).resolves.toEqual({ synced: true, questions: 4 });
    expect(mocks.setIceBreakers).toHaveBeenCalledWith("token", [
      { question: "Pergunta 1", payload: "campaign:a1" },
      { question: "Pergunta 2", payload: "campaign:a2" },
      { question: "Pergunta 3", payload: "campaign:a3" },
      { question: "Pergunta 4", payload: "campaign:a4" },
    ]);

    mocks.accountFindUnique.mockResolvedValue({ id: "acct", workspaceId: "ws", username: "marca", accessToken: "enc", automations: [] });
    await expect(syncAccountIceBreakers("acct")).resolves.toEqual({ synced: true, questions: 0 });
    expect(mocks.clearIceBreakers).toHaveBeenCalledWith("token");
  });

  it("records a Meta failure as an operational event instead of throwing", async () => {
    const { syncAccountIceBreakers } = await import("@/lib/meta/ice-breakers");
    mocks.accountFindUnique.mockResolvedValue({
      id: "acct",
      workspaceId: "ws",
      username: "marca",
      accessToken: "enc",
      automations: [{ id: "a1", iceBreakerQuestion: "Oi?" }],
    });
    mocks.setIceBreakers.mockRejectedValue(new Error("(#10) permission"));
    await expect(syncAccountIceBreakers("acct")).resolves.toMatchObject({ synced: false, error: "(#10) permission" });
    expect(mocks.operationalEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ workspaceId: "ws", level: "WARNING" }) })
    );
  });
});
