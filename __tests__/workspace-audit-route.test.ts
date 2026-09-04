import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentWorkspaceContext, mockPrisma } = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  mockPrisma: {
    auditEvent: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext,
  canManageMembers: (role: string) => role === "OWNER" || role === "ADMIN",
}));

import { GET } from "@/app/api/workspace/audit/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/workspace/audit", () => {
  it("blocks members from administrative history", async () => {
    getCurrentWorkspaceContext.mockResolvedValue({
      userId: "user_1",
      workspaceId: "workspace_1",
      role: "MEMBER",
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mockPrisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it("scopes history to the active workspace", async () => {
    getCurrentWorkspaceContext.mockResolvedValue({
      userId: "user_1",
      workspaceId: "workspace_1",
      role: "ADMIN",
    });
    mockPrisma.auditEvent.findMany.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mockPrisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "workspace_1" },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    );
  });
});
