import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentWorkspaceContext, getCurrentWorkspaceId, prisma } = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  getCurrentWorkspaceId: vi.fn(),
  prisma: {
    automation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    dmLog: { groupBy: vi.fn() },
    linkClick: { groupBy: vi.fn() },
    trackedLink: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId }));
vi.mock("@/lib/db/client", () => ({ prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext,
  canManageAutomations: (role: string) => role === "OWNER" || role === "ADMIN",
}));

import { GET, PATCH } from "@/app/api/automations/route";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentWorkspaceContext.mockResolvedValue({
    userId: "user_1",
    workspaceId: "workspace_1",
    role: "ADMIN",
  });
  getCurrentWorkspaceId.mockResolvedValue("workspace_1");
  prisma.automation.findMany.mockResolvedValue([]);
  prisma.dmLog.groupBy.mockResolvedValue([]);
  prisma.linkClick.groupBy.mockResolvedValue([]);
});

function updateRequest(id: string) {
  return new NextRequest(`http://localhost/api/automations?id=${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Automação atualizada" }),
  });
}

describe("automation workspace isolation", () => {
  it("derives an error state on the server without exposing credentials", async () => {
    prisma.automation.findMany.mockResolvedValueOnce([
      {
        id: "automation_1",
        workspaceId: "workspace_1",
        instagramAccountId: "account_1",
        name: "Campanha",
        isActive: true,
        pendingNextReel: false,
        postId: "media_1",
        reportShareSlug: "report_1",
        lastRunAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorKind: null,
        lastErrorMessage: null,
        consecutiveFailures: 0,
        instagramAccount: {
          username: "empresa",
          instagramId: "business_1",
          tokenExpiresAt: new Date("2020-01-01T00:00:00Z"),
        },
        trackedLinks: [],
        _count: { dmLogs: 0 },
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/automations")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "workspace_1" } })
    );
    expect(payload.data[0].operationalState).toMatchObject({
      state: "ERROR",
      needsAttention: true,
    });
    expect(JSON.stringify(payload)).not.toContain("accessToken");
    expect(JSON.stringify(payload)).not.toContain("lastErrorMessage");
  });

  it("returns a client error for malformed JSON without touching the database", async () => {
    const request = new NextRequest("http://localhost/api/automations?id=automation_1", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: "{",
    });
    const response = await PATCH(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Dados inválidos");
    expect(prisma.automation.findFirst).not.toHaveBeenCalled();
  });

  it("does not reveal or update an automation from another workspace", async () => {
    prisma.automation.findFirst.mockResolvedValue(null);

    const response = await PATCH(updateRequest("automation_other"));

    expect(response.status).toBe(404);
    expect(prisma.automation.findFirst).toHaveBeenCalledWith({
      where: { id: "automation_other", workspaceId: "workspace_1" },
    });
    expect(prisma.automation.update).not.toHaveBeenCalled();
  });

  it("repeats the workspace boundary in the update itself", async () => {
    prisma.automation.findFirst.mockResolvedValue({ id: "automation_1" });
    prisma.automation.update.mockResolvedValue({
      id: "automation_1",
      name: "Automação atualizada",
    });

    const response = await PATCH(updateRequest("automation_1"));

    expect(response.status).toBe(200);
    expect(prisma.automation.update).toHaveBeenCalledWith({
      where: { id: "automation_1", workspaceId: "workspace_1" },
      data: { name: "Automação atualizada" },
    });
  });
});
