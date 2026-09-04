import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserId, setActiveWorkspaceForUser } = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  setActiveWorkspaceForUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUserId }));
vi.mock("@/lib/workspace", () => ({ setActiveWorkspaceForUser }));

import { PUT } from "@/app/api/workspace/current/route";

function request(body: unknown) {
  return new Request("http://localhost/api/workspace/current", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PUT /api/workspace/current", () => {
  it("requires an authenticated user", async () => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await PUT(request({ workspaceId: "workspace_1" }));

    expect(response.status).toBe(401);
    expect(setActiveWorkspaceForUser).not.toHaveBeenCalled();
  });

  it("rejects malformed workspace identifiers", async () => {
    getCurrentUserId.mockResolvedValue("user_1");

    const response = await PUT(request({ workspaceId: "" }));

    expect(response.status).toBe(400);
    expect(setActiveWorkspaceForUser).not.toHaveBeenCalled();
  });

  it("does not switch to a workspace without membership", async () => {
    getCurrentUserId.mockResolvedValue("user_1");
    setActiveWorkspaceForUser.mockResolvedValue(null);

    const response = await PUT(request({ workspaceId: "workspace_other" }));

    expect(response.status).toBe(403);
    expect(setActiveWorkspaceForUser).toHaveBeenCalledWith(
      "user_1",
      "workspace_other"
    );
  });

  it("returns the selected workspace after persisting it", async () => {
    getCurrentUserId.mockResolvedValue("user_1");
    setActiveWorkspaceForUser.mockResolvedValue({
      role: "ADMIN",
      workspace: { id: "workspace_2", name: "Cliente Horizonte" },
    });

    const response = await PUT(request({ workspaceId: "workspace_2" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        workspace: { id: "workspace_2", name: "Cliente Horizonte" },
        role: "ADMIN",
      },
    });
  });
});
