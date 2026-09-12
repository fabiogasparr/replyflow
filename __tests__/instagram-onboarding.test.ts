import { describe, expect, it } from "vitest";
import { getInstagramConnectionCheck } from "@/lib/instagram-onboarding";

const now = Date.parse("2026-09-11T12:00:00Z");
describe("Instagram onboarding configuration checks", () => {
  it("reports only readiness for a test, never approval or delivery", () => {
    expect(getInstagramConnectionCheck({ tokenExpiresAt: "2026-10-11T12:00:00Z", webhookSubscribed: true }, now)).toBe("ready_to_test");
  });
  it("requires reconnection at the expiration boundary", () => {
    expect(getInstagramConnectionCheck({ tokenExpiresAt: new Date(now).toISOString(), webhookSubscribed: true }, now)).toBe("expired");
  });
  it.each([null, "invalid"])("does not infer validity from missing or malformed dates: %s", (tokenExpiresAt) => {
    expect(getInstagramConnectionCheck({ tokenExpiresAt, webhookSubscribed: true }, now)).toBe("unknown");
  });
  it("distinguishes an authorized account from webhook subscription", () => {
    expect(getInstagramConnectionCheck({ tokenExpiresAt: "2026-10-11T12:00:00Z", webhookSubscribed: false }, now)).toBe("webhook_pending");
  });
});
