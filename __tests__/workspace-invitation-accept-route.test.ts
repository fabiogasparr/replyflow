import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, mockPrisma } = vi.hoisted(() => ({
  auth: vi.fn(),
  mockPrisma: {
    workspaceInvitation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workspaceMember: { upsert: vi.fn() },
    user: { update: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { POST } from "@/app/api/workspace/invitations/accept/route";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (operations: unknown[]) =>
    Promise.all(operations)
  );
});

describe("POST /api/workspace/invitations/accept", () => {
  it("records the invitation acceptance in the invited workspace", async () => {
    auth.mockResolvedValue({
      user: { id: "user_1", email: "pessoa@empresa.com" },
    });
    mockPrisma.workspaceInvitation.findUnique.mockResolvedValue({
      id: "invitation_1",
      workspaceId: "workspace_1",
      email: "pessoa@empresa.com",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      workspace: { name: "Empresa" },
    });

    const response = await POST(
      new Request("http://localhost/api/workspace/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "invite-token" }),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        actorUserId: "user_1",
        action: "INVITATION_ACCEPTED",
        targetType: "WorkspaceInvitation",
        targetId: "invitation_1",
        metadata: { role: "MEMBER" },
      },
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    expect(mockPrisma.$transaction.mock.calls[0]?.[0]).toHaveLength(4);
  });

  it("does not write an event when the invitation belongs to another email", async () => {
    auth.mockResolvedValue({
      user: { id: "user_1", email: "outra@empresa.com" },
    });
    mockPrisma.workspaceInvitation.findUnique.mockResolvedValue({
      id: "invitation_1",
      workspaceId: "workspace_1",
      email: "pessoa@empresa.com",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      workspace: { name: "Empresa" },
    });

    const response = await POST(
      new Request("http://localhost/api/workspace/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "invite-token" }),
      }) as never
    );

    expect(response.status).toBe(403);
    expect(mockPrisma.auditEvent.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
