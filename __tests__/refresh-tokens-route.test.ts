import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  refreshLongLivedToken: vi.fn(),
  transaction: {
    instagramAccount: { update: vi.fn() },
    automation: { updateMany: vi.fn() },
  },
  prisma: {
    workspace: { updateMany: vi.fn() },
    instagramAccount: { findMany: vi.fn() },
    operationalEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: () => "plain-token",
  encryptToken: () => "encrypted-new-token",
}));
vi.mock("@/lib/meta/client", () => ({
  refreshLongLivedToken: mocks.refreshLongLivedToken,
}));

import { GET } from "@/app/api/cron/refresh-tokens/route";

function request(secret = "cron-secret") {
  return new NextRequest("http://localhost/api/cron/refresh-tokens", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  mocks.prisma.workspace.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.instagramAccount.findMany.mockResolvedValue([]);
  mocks.prisma.operationalEvent.create.mockResolvedValue({});
  mocks.transaction.instagramAccount.update.mockResolvedValue({});
  mocks.transaction.automation.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (transaction: typeof mocks.transaction) => unknown) =>
      callback(mocks.transaction)
  );
});

describe("token refresh operational recovery", () => {
  it("rejects the cron route when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.NEXTAUTH_SECRET;

    const response = await GET(request("undefined"));

    expect(response.status).toBe(401);
    expect(mocks.prisma.workspace.updateMany).not.toHaveBeenCalled();
  });

  it("renews the token and clears credential failures in the same workspace transaction", async () => {
    mocks.prisma.instagramAccount.findMany.mockResolvedValue([
      {
        id: "account_1",
        workspaceId: "workspace_1",
        username: "empresa",
        accessToken: "encrypted-old-token",
      },
    ]);
    mocks.refreshLongLivedToken.mockResolvedValue({
      accessToken: "new-token",
      expiresIn: 3600,
    });

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.results).toEqual([
      {
        instagramAccountId: "account_1",
        username: "empresa",
        status: "refreshed",
      },
    ]);
    expect(mocks.transaction.instagramAccount.update).toHaveBeenCalledWith({
      where: { id: "account_1", workspaceId: "workspace_1" },
      data: {
        accessToken: "encrypted-new-token",
        tokenExpiresAt: expect.any(Date),
      },
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
  });

  it("redacts credentials from refresh failure diagnostics", async () => {
    mocks.prisma.instagramAccount.findMany.mockResolvedValue([
      {
        id: "account_1",
        workspaceId: "workspace_1",
        username: "empresa",
        accessToken: "encrypted-old-token",
      },
    ]);
    mocks.refreshLongLivedToken.mockRejectedValue(
      new Error("request access_token=super-secret failed")
    );

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(JSON.stringify(payload)).not.toContain("super-secret");
    expect(mocks.prisma.operationalEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_1",
        message: "Token refresh failed for @empresa: request access_token=[removido] failed",
      }),
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
