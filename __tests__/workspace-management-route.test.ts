import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserId, mockPrisma } = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  mockPrisma: {
    workspaceMember: { findUnique: vi.fn() },
    workspace: { update: vi.fn() },
    automation: { updateMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ getCurrentUserId }));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/workspace-access", () => ({
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
  canArchiveWorkspace: (role: string) => role === "OWNER",
}));

import { PATCH } from "@/app/api/workspaces/[id]/route";

function request(body: unknown) {
  return new Request("http://localhost/api/workspaces/workspace_1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "workspace_1" }) };
const workspace = {
  id: "workspace_1",
  name: "Loja Aurora",
  archivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserId.mockResolvedValue("user_1");
  mockPrisma.$transaction.mockImplementation(
    async (callback: (client: typeof mockPrisma) => unknown) =>
      callback(mockPrisma)
  );
  mockPrisma.auditEvent.create.mockResolvedValue({});
});

describe("PATCH /api/workspaces/[id]", () => {
  it("does not reveal a workspace without membership", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);

    const response = await PATCH(request({ name: "Novo nome" }), context);

    expect(response.status).toBe(404);
    expect(mockPrisma.workspace.update).not.toHaveBeenCalled();
  });

  it("blocks members from changing workspace settings", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({
      role: "MEMBER",
      workspace,
    });

    const response = await PATCH(request({ name: "Novo nome" }), context);

    expect(response.status).toBe(403);
    expect(mockPrisma.workspace.update).not.toHaveBeenCalled();
  });

  it("allows admins to rename but not archive", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({
      role: "ADMIN",
      workspace,
    });
    mockPrisma.workspace.update.mockResolvedValue({
      ...workspace,
      name: "Cliente Horizonte",
    });

    const renamed = await PATCH(
      request({ name: "  Cliente   Horizonte " }),
      context
    );
    expect(renamed.status).toBe(200);
    expect(mockPrisma.workspace.update).toHaveBeenCalledWith({
      where: {
        id: "workspace_1",
        members: { some: { userId: "user_1", role: "ADMIN" } },
      },
      data: { name: "Cliente Horizonte" },
    });
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "WORKSPACE_RENAMED" }),
    });

    const archived = await PATCH(request({ archived: true }), context);
    expect(archived.status).toBe(403);
  });

  it("pauses active automations when the owner archives a workspace", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({
      role: "OWNER",
      workspace,
    });
    const archivedWorkspace = {
      ...workspace,
      archivedAt: new Date("2026-09-04"),
    };
    mockPrisma.workspace.update.mockResolvedValue(archivedWorkspace);
    mockPrisma.automation.updateMany.mockResolvedValue({ count: 3 });
    const response = await PATCH(request({ archived: true }), context);

    expect(response.status).toBe(200);
    expect(mockPrisma.automation.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace_1", isActive: true },
      data: { isActive: false },
    });
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "WORKSPACE_ARCHIVED" }),
    });
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { workspace: { archived: true } },
    });
  });

  it("restores data without reactivating old automations", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({
      role: "OWNER",
      workspace: { ...workspace, archivedAt: new Date("2026-09-04") },
    });
    mockPrisma.workspace.update.mockResolvedValue(workspace);

    const response = await PATCH(request({ archived: false }), context);

    expect(response.status).toBe(200);
    expect(mockPrisma.workspace.update).toHaveBeenCalledWith({
      where: {
        id: "workspace_1",
        members: { some: { userId: "user_1", role: "OWNER" } },
      },
      data: { archivedAt: null },
    });
    expect(mockPrisma.automation.updateMany).not.toHaveBeenCalled();
  });
});
