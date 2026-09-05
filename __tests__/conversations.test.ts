import { describe, expect, it } from "vitest";
import {
  buildMessagingWindow,
  sendConversationMessageSchema,
  updateConversationSchema,
} from "@/lib/conversations";

describe("conversation contracts", () => {
  it("normalizes notes and rejects unexpected state fields", () => {
    expect(updateConversationSchema.parse({ version: 2, notes: "  Próximo passo  " })).toEqual({
      version: 2,
      notes: "Próximo passo",
    });
    expect(updateConversationSchema.parse({ version: 2, notes: "   " }).notes).toBeNull();
    expect(updateConversationSchema.safeParse({ version: 2 })).toMatchObject({ success: false });
    expect(updateConversationSchema.safeParse({ version: 2, status: "OPEN", workspaceId: "other" })).toMatchObject({ success: false });
  });

  it("limits reply content and requires an explicit account", () => {
    expect(sendConversationMessageSchema.safeParse({ instagramAccountId: "a", recipientId: "p", text: " Olá " })).toMatchObject({
      success: true,
      data: { text: "Olá" },
    });
    expect(sendConversationMessageSchema.safeParse({ recipientId: "p", text: "Olá" }).success).toBe(false);
    expect(sendConversationMessageSchema.safeParse({ instagramAccountId: "a", recipientId: "p", text: "x".repeat(1001) }).success).toBe(false);
  });

  it("reports the standard 24-hour estimate without blocking on invalid dates", () => {
    const now = Date.now();
    expect(buildMessagingWindow(new Date(now - 60_000))).toMatchObject({ isOpen: true });
    expect(buildMessagingWindow(new Date(now - 25 * 60 * 60 * 1_000))).toMatchObject({ isOpen: false });
    expect(buildMessagingWindow("invalid")).toEqual({ lastInboundAt: null, expiresAt: null, isOpen: false });
  });
});
