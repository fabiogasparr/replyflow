import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ context: vi.fn(), missing: vi.fn(), state: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.context,
  canManageInstagram: (role: string) => ["OWNER", "ADMIN"].includes(role),
}));
vi.mock("@/lib/env", () => ({ getBaseUrl: () => "https://replyflow.example", getMissingInstagramOAuthEnv: mocks.missing }));
vi.mock("@/lib/meta/oauth", () => ({
  createOAuthState: mocks.state, INSTAGRAM_STATE_COOKIE: "replyflow-instagram-state",
  getAuthorizationUrl: () => "https://www.instagram.com/oauth/authorize?state=signed",
}));
import { GET } from "@/app/api/instagram/connect/route";
const request = (query = "?flow=wizard&workspaceId=workspace_a") => new NextRequest(`https://replyflow.example/api/instagram/connect${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ workspaceId: "workspace_a", userId: "user_a", role: "OWNER" });
  mocks.missing.mockReturnValue([]);
  mocks.state.mockReturnValue("signed");
});

describe("Instagram wizard authorization", () => {
  it("requires login", async () => {
    mocks.context.mockResolvedValue(null);
    expect((await GET(request())).headers.get("location")).toBe("https://replyflow.example/login");
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("blocks member authorization", async () => {
    mocks.context.mockResolvedValue({ role: "MEMBER" });
    expect((await GET(request())).headers.get("location")).toContain("/settings/instagram?instagram=forbidden");
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("refuses an attempt made from a stale workspace page", async () => {
    expect((await GET(request("?flow=wizard&workspaceId=workspace_b"))).headers.get("location")).toContain("instagram=workspace_changed");
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("returns platform errors to the wizard without exposing configuration names", async () => {
    mocks.missing.mockReturnValue(["INSTAGRAM_APP_SECRET"]);
    expect((await GET(request())).headers.get("location")).toBe("https://replyflow.example/settings/instagram?instagram=misconfigured");
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("binds the wizard return to signed state and the initiating browser", async () => {
    const response = await GET(request());
    expect(mocks.state).toHaveBeenCalledWith("workspace_a", "user_a", "wizard");
    expect(response.cookies.get("replyflow-instagram-state")).toMatchObject({ value: "signed", httpOnly: true, secure: true, sameSite: "lax", path: "/api/instagram/callback" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("ignores arbitrary return destinations", async () => {
    await GET(request("?flow=https://evil.example"));
    expect(mocks.state).toHaveBeenCalledWith("workspace_a", "user_a", undefined);
  });
});
