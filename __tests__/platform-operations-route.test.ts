import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getPlatformAccess, getPlatformOperationsSnapshot } = vi.hoisted(() => ({
  getPlatformAccess: vi.fn(),
  getPlatformOperationsSnapshot: vi.fn(),
}));

vi.mock("@/lib/platform-admin", () => ({ getPlatformAccess }));
vi.mock("@/lib/ops/platform-observability", () => ({
  getPlatformOperationsSnapshot,
}));

import { GET } from "@/app/api/platform/operations/route";

function request(query = "") {
  return new NextRequest(`http://localhost/api/platform/operations${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  getPlatformAccess.mockResolvedValue({
    authenticated: true,
    role: "ADMIN",
    admin: { id: "admin_1", name: "Admin", email: "admin@example.com" },
  });
  getPlatformOperationsSnapshot.mockResolvedValue({ status: "HEALTHY" });
});

describe("GET /api/platform/operations", () => {
  it("requires authentication before collecting metrics", async () => {
    getPlatformAccess.mockResolvedValue({ authenticated: false, role: null, admin: null });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(getPlatformOperationsSnapshot).not.toHaveBeenCalled();
  });

  it("denies authenticated non-platform administrators", async () => {
    getPlatformAccess.mockResolvedValue({ authenticated: true, role: "USER", admin: null });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(getPlatformOperationsSnapshot).not.toHaveBeenCalled();
  });

  it("rejects unsupported observation periods", async () => {
    const response = await GET(request("?period=30d"));

    expect(response.status).toBe(400);
    expect(getPlatformOperationsSnapshot).not.toHaveBeenCalled();
  });

  it("collects the requested rolling period without caching", async () => {
    const response = await GET(request("?period=7d"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getPlatformOperationsSnapshot).toHaveBeenCalledWith("7d");
    expect(payload).toEqual({ success: true, data: { status: "HEALTHY" } });
  });
});
