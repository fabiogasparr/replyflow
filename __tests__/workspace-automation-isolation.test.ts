import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentWorkspaceContext, prisma } = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  prisma: {
    automation: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    trackedLink: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext,
  canManageAutomations: (role: string) => role === "OWNER" || role === "ADMIN",
}));

import { PATCH } from "@/app/api/automations/route";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentWorkspaceContext.mockResolvedValue({
    userId: "user_1",
    workspaceId: "workspace_1",
    role: "ADMIN",
  });
});

function updateRequest(id: string) {
  return new NextRequest(`http://localhost/api/automations?id=${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Automação atualizada" }),
  });
}

describe("automation workspace isolation", () => {
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
