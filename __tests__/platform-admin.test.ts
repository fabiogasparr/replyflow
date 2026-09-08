import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUserId, userFindUnique } = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUserId }));
vi.mock("@/lib/db/client", () => ({
  prisma: { user: { findUnique: userFindUnique } },
}));

import { getPlatformAccess } from "@/lib/platform-admin";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPlatformAccess", () => {
  it("denies unauthenticated requests without querying a user", async () => {
    getCurrentUserId.mockResolvedValue(null);

    await expect(getPlatformAccess()).resolves.toEqual({
      authenticated: false,
      role: null,
      admin: null,
    });
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("keeps regular users outside platform administration", async () => {
    getCurrentUserId.mockResolvedValue("user_1");
    userFindUnique.mockResolvedValue({
      id: "user_1",
      name: "Ana",
      email: "ana@example.com",
      platformRole: "USER",
    });

    await expect(getPlatformAccess()).resolves.toEqual({
      authenticated: true,
      role: "USER",
      admin: null,
    });
  });

  it("returns only the minimum identity for a persisted global admin", async () => {
    getCurrentUserId.mockResolvedValue("admin_1");
    userFindUnique.mockResolvedValue({
      id: "admin_1",
      name: "Operação",
      email: "ops@example.com",
      platformRole: "ADMIN",
    });

    await expect(getPlatformAccess()).resolves.toEqual({
      authenticated: true,
      role: "ADMIN",
      admin: {
        id: "admin_1",
        name: "Operação",
        email: "ops@example.com",
      },
    });
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { id: "admin_1" },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
      },
    });
  });
});
