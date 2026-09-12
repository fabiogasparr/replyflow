import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MetaApiError,
  PermissionError,
  RateLimitError,
  TokenExpiredError,
  sendCommentReply,
} from "@/lib/meta/client";

function graphError(code: number, message = "boom") {
  return {
    ok: false,
    status: 400,
    url: "https://graph.instagram.com/v25.0/comment_1/replies?access_token=secret",
    json: async () => ({ error: { message, code, type: "OAuthException" } }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Meta API error mapping", () => {
  it.each([
    [368, RateLimitError],
    [4, RateLimitError],
    [17, RateLimitError],
    [32, RateLimitError],
    [613, RateLimitError],
    [190, TokenExpiredError],
    [10, PermissionError],
    [200, PermissionError],
    [9999, MetaApiError],
  ])("maps code %s to the right error class", async (code, expected) => {
    vi.stubGlobal("fetch", vi.fn(async () => graphError(code)));
    await expect(sendCommentReply("token", "comment_1", "oi")).rejects.toBeInstanceOf(expected);
  });

  it("never leaks the access token into the error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => graphError(613, "Calls to this api have exceeded the rate limit.")));
    const error = (await sendCommentReply("token", "comment_1", "oi").catch(
      (e: unknown) => e
    )) as Error;
    expect(error.message).toContain("code=613");
    expect(error.message).toContain("/comment_1/replies");
    expect(error.message).not.toContain("secret");
  });
});
