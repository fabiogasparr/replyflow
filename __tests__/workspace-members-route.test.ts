import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentWorkspaceContext, mockPrisma } = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  mockPrisma: {
    workspaceMember: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    workspaceInvitation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext,
  canManageMembers: (role: string) => role === "OWNER" || role === "ADMIN",
  canAssignWorkspaceRole: (actor: string, assigned: string) =>
    actor === "OWNER" || (actor === "ADMIN" && assigned === "MEMBER"),
  canManageWorkspaceMember: (actor: string, target: string) =>
    target !== "OWNER" &&
    (actor === "OWNER" || (actor === "ADMIN" && target === "MEMBER")),
}));

import { GET, PATCH, POST } from "@/app/api/workspace/members/route";

function context(role: "OWNER" | "ADMIN" | "MEMBER") {
  return {
    userId: "user_actor",
    workspaceId: "workspace_1",
    workspace: { id: "workspace_1", name: "Aurora" },
    role,
  };
}

function request(method: "POST" | "PATCH", body: unknown) {
  return new NextRequest("http://localhost/api/workspace/members", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.workspaceMember.findMany.mockResolvedValue([]);
  mockPrisma.workspaceInvitation.findMany.mockResolvedValue([]);
  mockPrisma.workspaceInvitation.findUnique.mockResolvedValue(null);
  mockPrisma.workspaceMember.count.mockResolvedValue(1);
  mockPrisma.workspaceInvitation.count.mockResolvedValue(0);
  mockPrisma.workspace.findUnique.mockResolvedValue({ plan: "FREE" });
  mockPrisma.auditEvent.create.mockResolvedValue({});
  mockPrisma.$transaction.mockImplementation(
    async (callback: (client: typeof mockPrisma) => unknown) =>
      callback(mockPrisma)
  );
});

describe("workspace member authorization", () => {
  it("does not expose pending invitation tokens to members", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("MEMBER"));

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      currentUserId: "user_actor",
      currentUserRole: "MEMBER",
      invitations: [],
    });
    expect(mockPrisma.workspaceInvitation.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.workspaceInvitation.updateMany).not.toHaveBeenCalled();
  });

  it("expires old pending invitations before returning manager data", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("OWNER"));
    mockPrisma.workspaceInvitation.updateMany.mockResolvedValue({ count: 2 });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mockPrisma.workspaceInvitation.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        status: "PENDING",
        expiresAt: { lte: expect.any(Date) },
      },
      data: { status: "EXPIRED" },
    });
  });

  it("prevents admins from inviting another admin", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("ADMIN"));

    const response = await POST(
      request("POST", { email: "admin@example.com", role: "ADMIN" })
    );

    expect(response.status).toBe(403);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("never changes the owner's role through a repeated invitation", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("OWNER"));
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user_owner" });
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({
      userId: "user_owner",
      role: "OWNER",
    });

    const response = await POST(
      request("POST", { email: "owner@example.com", role: "MEMBER" })
    );

    expect(response.status).toBe(403);
    expect(mockPrisma.workspaceMember.upsert).not.toHaveBeenCalled();
  });

  it("renews a pending invitation with a fresh token and expiry", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("OWNER"));
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.workspaceInvitation.findUnique.mockResolvedValue({
      id: "invitation_1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockPrisma.workspaceInvitation.upsert.mockResolvedValue({
      id: "invitation_1",
    });
    mockPrisma.workspaceInvitation.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(
      request("POST", { email: " pessoa@example.com ", role: "MEMBER" })
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.workspaceInvitation.upsert).toHaveBeenCalledWith({
      where: {
        workspaceId_email: {
          workspaceId: "workspace_1",
          email: "pessoa@example.com",
        },
      },
      create: expect.objectContaining({
        workspaceId: "workspace_1",
        email: "pessoa@example.com",
        token: expect.any(String),
        expiresAt: expect.any(Date),
      }),
      update: expect.objectContaining({
        status: "PENDING",
        token: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
    expect(mockPrisma.workspaceMember.count).not.toHaveBeenCalled();
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "INVITATION_RENEWED" }),
    });
  });

  it("blocks a new invitation when all plan seats are reserved", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("OWNER"));
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.workspaceMember.count.mockResolvedValue(2);

    const response = await POST(
      request("POST", { email: "nova@example.com", role: "MEMBER" })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "PLAN_LIMIT_REACHED",
      data: { resource: "members", limit: 2 },
    });
    expect(mockPrisma.workspaceInvitation.upsert).not.toHaveBeenCalled();
  });

  it("converts a reserved invitation without consuming another seat", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("OWNER"));
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user_invited" });
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);
    mockPrisma.workspaceInvitation.findUnique.mockResolvedValue({
      id: "invitation_1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockPrisma.workspaceMember.count.mockResolvedValue(2);

    const response = await POST(
      request("POST", { email: "pessoa@example.com", role: "MEMBER" })
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.workspaceMember.count).not.toHaveBeenCalled();
    expect(mockPrisma.workspaceInvitation.update).toHaveBeenCalledWith({
      where: { id: "invitation_1", workspaceId: "workspace_1" },
      data: { status: "ACCEPTED", acceptedAt: expect.any(Date) },
    });
  });

  it("prevents admins from demoting other admins", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("ADMIN"));
    mockPrisma.workspaceMember.findFirst.mockResolvedValue({
      id: "member_admin",
      userId: "user_other",
      role: "ADMIN",
    });

    const response = await PATCH(
      request("PATCH", { memberId: "member_admin", role: "MEMBER" })
    );

    expect(response.status).toBe(403);
    expect(mockPrisma.workspaceMember.update).not.toHaveBeenCalled();
  });

  it("allows owners to change a non-owner role", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("OWNER"));
    mockPrisma.workspaceMember.findFirst.mockResolvedValue({
      id: "member_admin",
      userId: "user_other",
      role: "ADMIN",
    });
    mockPrisma.workspaceMember.update.mockResolvedValue({});

    const response = await PATCH(
      request("PATCH", { memberId: "member_admin", role: "MEMBER" })
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.workspaceMember.update).toHaveBeenCalledWith({
      where: { id: "member_admin", workspaceId: "workspace_1" },
      data: { role: "MEMBER" },
    });
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "MEMBER_ROLE_CHANGED",
        targetId: "user_other",
      }),
    });
  });
});
