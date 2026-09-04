import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentWorkspaceContext, mockPrisma } = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  mockPrisma: {
    workspaceMember: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    workspaceInvitation: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
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
      where: { id: "member_admin" },
      data: { role: "MEMBER" },
    });
  });
});
