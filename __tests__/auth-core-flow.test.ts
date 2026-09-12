/** Real Auth.js request pipeline; database, quota service and email delivery are isolated doubles. */
import { randomUUID } from "node:crypto";
import { Auth, type AuthConfig } from "@auth/core";
import type { Adapter, AdapterSession, AdapterUser, VerificationToken } from "@auth/core/adapters";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reserve: vi.fn(), send: vi.fn(), workspace: vi.fn() }));
// Only the Next.js wrapper is replaced: requests below execute @auth/core itself.
vi.mock("next-auth", () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/auth-rate-limit", () => ({ reserveAuthEmail: mocks.reserve }));
vi.mock("@/lib/workspace", () => ({ ensureWorkspaceForUser: mocks.workspace, getActiveWorkspace: vi.fn() }));
vi.mock("@/lib/auth-email", () => ({ sendSmtpVerification: mocks.send, sendResendVerification: mocks.send }));
import { authConfig, EMAIL_PROVIDER_ID } from "@/lib/auth";

const base = "https://replyflow.test";
const email = "tester@replyflow.test";
let tokens: Map<string, VerificationToken>;
let sessions: Map<string, AdapterSession>;
let users: Map<string, AdapterUser>;
let cookies: Map<string, string>;
let config: AuthConfig;
let createToken: ReturnType<typeof vi.fn<(token: VerificationToken) => Promise<VerificationToken>>>;
let network: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALLOWED_EMAILS", email);
  network = vi.fn(() => { throw new Error("Network access is forbidden in this test"); });
  vi.stubGlobal("fetch", network);
  tokens = new Map(); sessions = new Map(); users = new Map(); cookies = new Map();
  mocks.reserve.mockResolvedValue({ allowed: true });
  mocks.send.mockResolvedValue(undefined);
  mocks.workspace.mockResolvedValue({ id: "fixture-workspace" });
  createToken = vi.fn(async (token: VerificationToken) => { tokens.set(`${token.identifier}:${token.token}`, token); return token; });
  const adapter: Adapter = {
    createVerificationToken: createToken,
    useVerificationToken: async ({ identifier, token }) => {
      const key = `${identifier}:${token}`;
      const result = tokens.get(key) ?? null;
      tokens.delete(key);
      return result;
    },
    getUser: async (id) => users.get(id) ?? null,
    getUserByEmail: async (address) => [...users.values()].find((user) => user.email === address) ?? null,
    getUserByAccount: async () => null,
    createUser: async (data) => {
      const user = { ...data, id: randomUUID() };
      users.set(user.id, user);
      return user;
    },
    updateUser: async (data) => {
      const previous = users.get(data.id);
      if (!previous) throw new Error("Fixture user not found");
      const user = { ...previous, ...data };
      users.set(user.id, user);
      return user;
    },
    createSession: async (session) => { sessions.set(session.sessionToken, session); return session; },
    getSessionAndUser: async (token) => {
      const session = sessions.get(token);
      const user = session && users.get(session.userId);
      return session && user ? { session, user } : null;
    },
    updateSession: async (data) => {
      const previous = sessions.get(data.sessionToken);
      if (!previous) return null;
      const session = { ...previous, ...data };
      sessions.set(session.sessionToken, session);
      return session;
    },
    deleteSession: async (token) => { sessions.delete(token); },
    linkAccount: async () => {},
  };
  config = {
    ...authConfig, adapter, basePath: "/api/auth",
    secret: "auth-core-flow-synthetic-secret-for-tests",
    logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
});

afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function request(path: string, body?: URLSearchParams) {
  const url = new URL(path, base);
  expect(url.origin).toBe(base);
  const response = await Auth(new Request(url, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    }, body,
  }), config);
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0];
    const at = pair.indexOf("=");
    cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return response;
}

async function beginSignIn(address = email, withCsrf = true) {
  const csrf = await (await request("/api/auth/csrf")).json();
  return request(`/api/auth/signin/${EMAIL_PROVIDER_ID}`, new URLSearchParams({
    csrfToken: withCsrf ? csrf.csrfToken : "invalid-csrf",
    email: address, callbackUrl: `${base}/dashboard`,
  }));
}

function sentLink(): string {
  expect(mocks.send).toHaveBeenCalledTimes(1);
  return mocks.send.mock.calls[0][0].url;
}

describe("real Auth.js email request flow", () => {
  it("requires CSRF before checking quota or generating a token", async () => {
    await beginSignIn(email, false);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(createToken).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each(["outsider@replyflow.test", `${email},other@replyflow.test`])("rejects unauthorized or malformed input before side effects: %s", async (address) => {
    await beginSignIn(address);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(createToken).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([['limited', 'TooManyRequests'], ['unavailable', 'ServiceUnavailable']])("does not create a token or send when quota service says %s", async (reason, code) => {
    mocks.reserve.mockResolvedValue({ allowed: false, reason, retryAfterSeconds: 60 });
    const response = await beginSignIn();
    expect(response.headers.get("location")).toBe(`${base}/login/error?error=${code}`);
    expect(createToken).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(users.size).toBe(0);
    expect(sessions.size).toBe(0);
  });

  it("preserves the first link after a blocked resend and authenticates even when the quota service is unavailable", async () => {
    await beginSignIn(" Tester@ReplyFlow.Test ");
    const link = sentLink();
    const plainToken = new URL(link).searchParams.get("token");
    expect(plainToken).toBeTruthy();
    expect([...tokens.values()][0].token).not.toBe(plainToken);
    expect(mocks.reserve).toHaveBeenCalledWith(email);
    expect(users.size).toBe(0);

    mocks.reserve.mockResolvedValue({ allowed: false, reason: "limited", retryAfterSeconds: 60 });
    await beginSignIn();
    expect(createToken).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(tokens.size).toBe(1);

    mocks.reserve.mockRejectedValue(new Error("Must not consult quota for an issued link"));
    const callsBefore = mocks.reserve.mock.calls.length;
    const callback = await request(link);
    expect(callback.headers.get("location")).toBe(`${base}/dashboard`);
    const sessionCookie = callback.headers.getSetCookie().find((cookie) => cookie.startsWith("__Secure-authjs.session-token="));
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("SameSite=Lax");
    const session = await (await request("/api/auth/session")).json();
    expect(session.user.email).toBe(email);
    expect(session.user.id).toBe([...users.keys()][0]);
    expect(mocks.workspace).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(callsBefore);
    expect(tokens.size).toBe(0);

    const replay = await request(link);
    expect(replay.headers.get("location")).toContain("error=Verification");
    expect(sessions.size).toBe(1);
  });

  it("does not authenticate a changed recipient using another recipient's token", async () => {
    await beginSignIn();
    const original = sentLink();
    const changed = new URL(original);
    changed.searchParams.set("email", "other@replyflow.test");
    expect((await request(changed.toString())).headers.get("location")).toContain("error=Verification");
    expect(users.size).toBe(0);
    expect(sessions.size).toBe(0);
    expect(tokens.size).toBe(1);
    expect((await request(original)).headers.get("location")).toBe(`${base}/dashboard`);
  });

  it("keeps token expiration enforced while quota checks are skipped on redemption", async () => {
    await beginSignIn();
    const link = sentLink();
    for (const token of tokens.values()) token.expires = new Date(0);
    expect((await request(link)).headers.get("location")).toContain("error=Verification");
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(users.size).toBe(0);
    expect(sessions.size).toBe(0);
  });
});
