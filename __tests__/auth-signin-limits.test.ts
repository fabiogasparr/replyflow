import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ allowed: vi.fn(), reserve: vi.fn() }));
vi.mock("next-auth", () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/env", () => ({ isEmailAllowedToSignIn: mocks.allowed }));
vi.mock("@/lib/auth-rate-limit", () => ({ reserveAuthEmail: mocks.reserve }));
import { authConfig } from "@/lib/auth";

const user = { id: "synthetic-user", email: "tester@replyflow.test" };
beforeEach(() => { vi.clearAllMocks(); mocks.allowed.mockReturnValue(true); mocks.reserve.mockResolvedValue({ allowed: true }); });

describe("Auth.js sign-in gate", () => {
  it("applies email allowlist before consuming any quota", async () => {
    mocks.allowed.mockReturnValue(false);
    expect(await authConfig.callbacks.signIn({ user, account: null, email: { verificationRequest: true } })).toBe(false);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("reserves a slot for both HTTP and server-action verification requests", async () => {
    expect(await authConfig.callbacks.signIn({ user, account: null, email: { verificationRequest: true } })).toBe(true);
    expect(mocks.reserve).toHaveBeenCalledWith(user.email);
  });
  it("redirects limited requests before Auth.js creates or sends a new token", async () => {
    mocks.reserve.mockResolvedValue({ allowed: false, reason: "limited", retryAfterSeconds: 60 });
    expect(await authConfig.callbacks.signIn({ user, account: null, email: { verificationRequest: true } })).toBe("/login/error?error=TooManyRequests");
  });
  it("reports unavailable protection without permitting a new email", async () => {
    mocks.reserve.mockResolvedValue({ allowed: false, reason: "unavailable", retryAfterSeconds: 60 });
    expect(await authConfig.callbacks.signIn({ user, account: null, email: { verificationRequest: true } })).toBe("/login/error?error=ServiceUnavailable");
  });
  it("allows verification of an already issued link without Redis", async () => {
    mocks.reserve.mockRejectedValue(new Error("must not call"));
    expect(await authConfig.callbacks.signIn({ user, account: null })).toBe(true);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
});
