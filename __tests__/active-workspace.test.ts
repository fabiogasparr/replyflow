import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    workspaceInvitation: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    workspace: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

import {
  createWorkspaceForUser,
  getWorkspaceMembership,
  listUserWorkspaces,
  normalizeWorkspaceName,
  setActiveWorkspaceForUser,
} from "../lib/workspace";

const workspace = {
  id: "workspace_active",
  name: "Loja Aurora",
  ownerId: "user_owner",
  usagePeriodStart: new Date("2026-09-01"),
  dmsSentThisPeriod: 12,
  createdAt: new Date("2026-08-01"),
  updatedAt: new Date("2026-09-01"),
  archivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("active workspace selection", () => {
  it("uses the saved workspace only when the user is still a member", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      activeWorkspaceId: workspace.id,
    });
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({
      workspaceId: workspace.id,
      role: "ADMIN",
      workspace,
    });

    await expect(getWorkspaceMembership("user_1")).resolves.toEqual({
      workspace,
      role: "ADMIN",
    });
    expect(mockPrisma.workspaceMember.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("repairs a stale selection with the oldest remaining membership", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      activeWorkspaceId: "workspace_removed",
    });
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);
    mockPrisma.workspaceMember.findFirst.mockResolvedValue({
      workspaceId: workspace.id,
      role: "MEMBER",
      workspace,
    });

    await expect(getWorkspaceMembership("user_1")).resolves.toEqual({
      workspace,
      role: "MEMBER",
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { activeWorkspaceId: workspace.id },
    });
  });

  it("does not expose a workspace without a matching membership", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);

    await expect(
      setActiveWorkspaceForUser("user_1", "workspace_other")
    ).resolves.toBeNull();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("persists a workspace after membership validation", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({
      workspaceId: workspace.id,
      role: "OWNER",
      workspace,
    });
    mockPrisma.user.update.mockResolvedValue({});

    await expect(
      setActiveWorkspaceForUser("user_1", workspace.id)
    ).resolves.toEqual({ workspace, role: "OWNER" });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { activeWorkspaceId: workspace.id },
    });
  });

  it("lists only workspaces reached through the user's memberships", async () => {
    mockPrisma.workspaceMember.findMany.mockResolvedValue([
      {
        role: "OWNER",
        workspace: { id: "workspace_1", name: "Aurora", archivedAt: null },
      },
      {
        role: "ADMIN",
        workspace: { id: "workspace_2", name: "Horizonte", archivedAt: null },
      },
    ]);

    await expect(listUserWorkspaces("user_1")).resolves.toEqual([
      { id: "workspace_1", name: "Aurora", role: "OWNER", archived: false },
      { id: "workspace_2", name: "Horizonte", role: "ADMIN", archived: false },
    ]);
    expect(mockPrisma.workspaceMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user_1", workspace: { archivedAt: null } },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        workspace: { select: { id: true, name: true, archivedAt: true } },
      },
    });
  });

  it("normalizes and creates a workspace as the user's active workspace", async () => {
    const transactionClient = {
      workspace: { create: vi.fn().mockResolvedValue(workspace) },
      user: { update: vi.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation(
      async (callback: (client: typeof transactionClient) => unknown) =>
        callback(transactionClient)
    );

    expect(normalizeWorkspaceName("  Loja   Aurora  ")).toBe("Loja Aurora");
    await expect(
      createWorkspaceForUser("user_1", "  Loja   Aurora  ")
    ).resolves.toEqual(workspace);
    expect(transactionClient.workspace.create).toHaveBeenCalledWith({
      data: {
        name: "Loja Aurora",
        ownerId: "user_1",
        members: { create: { userId: "user_1", role: "OWNER" } },
      },
    });
    expect(transactionClient.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { activeWorkspaceId: workspace.id },
    });
  });
});
