import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), missing: vi.fn(),
  prisma: { instagramAccount: { findMany: vi.fn() }, subscription: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/env", () => ({ getMissingInstagramOAuthEnv: mocks.missing }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.context,
  canManageInstagram: (role: string) => ["OWNER", "ADMIN"].includes(role),
}));
import { GET } from "@/app/api/instagram/onboarding/route";

const context = { workspaceId: "workspace_a", workspace: { name: "Loja A" }, role: "OWNER" };
const request = (query = "") => new NextRequest(`http://localhost/api/instagram/onboarding${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(context);
  mocks.missing.mockReturnValue([]);
  mocks.prisma.instagramAccount.findMany.mockResolvedValue([]);
  mocks.prisma.subscription.findUnique.mockResolvedValue({ plan: { instagramAccounts: 1 } });
});

describe("GET Instagram onboarding", () => {
  it("requires a session before looking up account data", async () => {
    mocks.context.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.prisma.instagramAccount.findMany).not.toHaveBeenCalled();
  });
  it("blocks a return to an inactive workspace without revealing its data", async () => {
    const response = await GET(request("?workspaceId=workspace_b"));
    expect(response.status).toBe(409);
    expect(mocks.prisma.instagramAccount.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.subscription.findUnique).not.toHaveBeenCalled();
  });
  it("scopes all queries and selects no tokens or unnecessary identifiers", async () => {
    mocks.prisma.instagramAccount.findMany.mockResolvedValue([{
      id: "account_a", username: "loja", tokenExpiresAt: new Date("2099-01-01"), webhookSubscribed: true,
    }]);
    const response = await GET(request("?workspaceId=workspace_a"));
    const { data } = await response.json();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.prisma.instagramAccount.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_a" }, orderBy: { connectedAt: "desc" },
      select: { id: true, username: true, tokenExpiresAt: true, webhookSubscribed: true },
    });
    expect(mocks.prisma.subscription.findUnique).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_a" }, select: { plan: { select: { instagramAccounts: true } } },
    });
    expect(data.accounts[0].check).toBe("ready_to_test");
    expect(data.accounts[0]).not.toHaveProperty("accessToken");
    expect(data).not.toHaveProperty("approved");
  });
  it("permits member guidance without authorizing connection management", async () => {
    mocks.context.mockResolvedValue({ ...context, role: "MEMBER" });
    expect((await (await GET(request())).json()).data.canManage).toBe(false);
  });
  it("distinguishes missing platform configuration and billing without leaking env names", async () => {
    mocks.missing.mockReturnValue(["INSTAGRAM_APP_SECRET"]);
    mocks.prisma.subscription.findUnique.mockResolvedValue(null);
    const body = await (await GET(request())).json();
    expect(body.data.oauthConfigured).toBe(false);
    expect(body.data.accountLimit).toBeNull();
    expect(JSON.stringify(body)).not.toContain("INSTAGRAM_APP_SECRET");
  });
  it("returns a safe retryable error if the database fails", async () => {
    mocks.prisma.instagramAccount.findMany.mockRejectedValue(new Error("postgres://private-secret"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-secret");
  });
});
