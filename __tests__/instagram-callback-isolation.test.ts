import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  canConnectInstagramAccount: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  getLongLivedToken: vi.fn(),
  getUserInfo: vi.fn(),
  subscribeInstagramAccountToWebhooks: vi.fn(),
  transaction: {
    workspaceMember: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
    instagramAccount: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    automation: { updateMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  prisma: {
    workspaceMember: { findFirst: vi.fn() },
    operationalEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/env", () => ({ getBaseUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/instagram-accounts", () => ({
  canConnectInstagramAccount: mocks.canConnectInstagramAccount,
}));
vi.mock("@/lib/meta/oauth", () => ({
  INSTAGRAM_STATE_COOKIE: "replyflow-instagram-state",
  verifyOAuthState: () => ({ workspaceId: "workspace_1", userId: "user_1" }),
  exchangeCodeForToken: mocks.exchangeCodeForToken,
  encryptToken: () => "encrypted-token",
}));
vi.mock("@/lib/meta/client", () => ({
  getLongLivedToken: mocks.getLongLivedToken,
  getUserInfo: mocks.getUserInfo,
  subscribeInstagramAccountToWebhooks:
    mocks.subscribeInstagramAccountToWebhooks,
}));
vi.mock("@/lib/workspace-access", () => ({
  canManageInstagram: (role: string) => role === "OWNER" || role === "ADMIN",
}));

import { GET } from "@/app/api/instagram/callback/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
  mocks.prisma.workspaceMember.findFirst.mockResolvedValue({ role: "ADMIN" });
  mocks.canConnectInstagramAccount.mockResolvedValue({ allowed: true });
  mocks.exchangeCodeForToken.mockResolvedValue({ accessToken: "short-token" });
  mocks.getLongLivedToken.mockResolvedValue({
    accessToken: "long-token",
    expiresIn: 3600,
  });
  mocks.getUserInfo.mockResolvedValue({
    id: "meta_app_id",
    user_id: "instagram_1",
    username: "loja",
    name: "Loja",
  });
  mocks.subscribeInstagramAccountToWebhooks.mockResolvedValue({ success: true });
  mocks.transaction.workspaceMember.findUnique.mockResolvedValue({ role: "ADMIN" });
  mocks.transaction.workspace.findUnique.mockResolvedValue({
    subscription: { plan: { instagramAccounts: 3 } },
    _count: { instagramAccounts: 0 },
  });
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (transaction: typeof mocks.transaction) => unknown) =>
      callback(mocks.transaction)
  );
  mocks.prisma.operationalEvent.create.mockResolvedValue({});
});

function callbackRequest() {
  return new NextRequest(
    "http://localhost:3000/api/instagram/callback?code=code&state=state",
    { headers: { cookie: "replyflow-instagram-state=state" } },
  );
}

describe("Instagram callback workspace isolation", () => {
  it("rejects callbacks without the initiating browser cookie", async () => {
    const response = await GET(new NextRequest("http://localhost:3000/api/instagram/callback?code=code&state=state"));
    expect(response.headers.get("location")).toContain("instagram=invalid");
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it("rejects a callback completed by a different signed-in user", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_other" } });
    const response = await GET(callbackRequest());
    expect(response.headers.get("location")).toContain("instagram=invalid");
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(mocks.prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
  });

  it("does not return a remote error containing credentials in the URL or event", async () => {
    mocks.exchangeCodeForToken.mockRejectedValueOnce(new Error("access_token=secret-customer-token"));
    const response = await GET(callbackRequest());
    expect(response.headers.get("location")).toBe("http://localhost:3000/settings?instagram=failed");
    expect(JSON.stringify(mocks.prisma.operationalEvent.create.mock.calls)).not.toContain("secret-customer-token");
    expect(response.cookies.get("replyflow-instagram-state")?.value).toBe("");
  });
  it("does not transfer an account found in another workspace", async () => {
    mocks.transaction.instagramAccount.findUnique.mockResolvedValue({
      id: "account_1",
      workspaceId: "workspace_2",
    });

    const response = await GET(callbackRequest());

    expect(response.headers.get("location")).toContain(
      "/settings?instagram=failed"
    );
    expect(mocks.transaction.instagramAccount.update).not.toHaveBeenCalled();
    expect(mocks.transaction.instagramAccount.create).not.toHaveBeenCalled();
    expect(mocks.transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  it("updates a reconnection only inside the same workspace", async () => {
    mocks.transaction.instagramAccount.findUnique.mockResolvedValue({
      id: "account_1",
      workspaceId: "workspace_1",
    });
    mocks.transaction.instagramAccount.update.mockResolvedValue({
      id: "account_1",
      workspaceId: "workspace_1",
      username: "loja",
      webhookSubscribed: true,
    });

    const response = await GET(callbackRequest());

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard?connected=true"
    );
    expect(mocks.transaction.instagramAccount.update).toHaveBeenCalledWith({
      where: { id: "account_1", workspaceId: "workspace_1" },
      data: expect.not.objectContaining({ workspaceId: expect.anything() }),
    });
    expect(mocks.transaction.automation.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        instagramAccountId: "account_1",
        lastErrorKind: { in: ["AUTHENTICATION", "CONFIGURATION"] },
      },
      data: {
        lastErrorAt: null,
        lastErrorKind: null,
        lastErrorMessage: null,
        consecutiveFailures: 0,
      },
    });
    expect(mocks.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_1",
        action: "INSTAGRAM_CONNECTED",
      }),
    });
  });

  it("rechecks plan capacity inside the connection transaction", async () => {
    mocks.transaction.instagramAccount.findUnique.mockResolvedValue(null);
    mocks.transaction.workspace.findUnique.mockResolvedValue({
      subscription: { plan: { instagramAccounts: 1 } },
      _count: { instagramAccounts: 1 },
    });

    const response = await GET(callbackRequest());

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/settings?instagram=plan_limit"
    );
    expect(mocks.transaction.instagramAccount.create).not.toHaveBeenCalled();
    expect(mocks.prisma.operationalEvent.create).not.toHaveBeenCalled();
  });

  it("reports billing setup without persisting an operational failure", async () => {
    mocks.transaction.instagramAccount.findUnique.mockResolvedValue(null);
    mocks.transaction.workspace.findUnique.mockResolvedValue({
      subscription: null,
      _count: { instagramAccounts: 0 },
    });

    const response = await GET(callbackRequest());

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/settings?instagram=billing_setup"
    );
    expect(mocks.transaction.instagramAccount.create).not.toHaveBeenCalled();
    expect(mocks.prisma.operationalEvent.create).not.toHaveBeenCalled();
  });
});
