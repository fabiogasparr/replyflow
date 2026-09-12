import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  buildDeletionStatusUrl,
  generateConfirmationCode,
  getMetaAppSecrets,
  isConfirmationCode,
  parseSignedRequest,
  signRequest,
} from "@/lib/meta/data-deletion";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  auditCreate: vi.fn(),
  eventCreate: vi.fn(),
  eventFindFirst: vi.fn(),
}));

vi.mock("@/lib/db/client", () => {
  const transaction = {
    instagramAccount: { deleteMany: mocks.deleteMany },
    auditEvent: { create: mocks.auditCreate },
    operationalEvent: { create: mocks.eventCreate },
  };
  return {
    prisma: {
      instagramAccount: { findMany: mocks.findMany },
      operationalEvent: { findFirst: mocks.eventFindFirst },
      $transaction: async (fn: (tx: typeof transaction) => Promise<void>) => fn(transaction),
    },
  };
});
vi.mock("@/lib/env", () => ({ getBaseUrl: () => "https://replyflow.example" }));

import { GET, POST } from "@/app/api/meta/data-deletion/route";
import { findDeletionRequest } from "@/lib/meta/data-deletion-status";

const SECRET = "instagram-secret";

function formRequest(signedRequest: string) {
  return new NextRequest("https://replyflow.example/api/meta/data-deletion", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ signed_request: signedRequest }).toString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("INSTAGRAM_APP_SECRET", SECRET);
  vi.stubEnv("FACEBOOK_APP_SECRET", "facebook-secret");
  mocks.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signed_request parsing", () => {
  it("accepts a request signed with either app secret", () => {
    const payload = { user_id: "1789", algorithm: "HMAC-SHA256", issued_at: 1 };
    expect(parseSignedRequest(signRequest(payload, SECRET), getMetaAppSecrets())).toEqual(payload);
    expect(
      parseSignedRequest(signRequest(payload, "facebook-secret"), getMetaAppSecrets())
    ).toEqual(payload);
  });

  it("rejects tampering, wrong secrets and garbage", () => {
    const signed = signRequest({ user_id: "1789", algorithm: "HMAC-SHA256" }, SECRET);
    const [signature, body] = signed.split(".");
    const forged = `${signature}.${Buffer.from('{"user_id":"other"}').toString("base64url")}`;
    expect(parseSignedRequest(forged, [SECRET])).toBeNull();
    expect(parseSignedRequest(`${signature}x.${body}`, [SECRET])).toBeNull();
    expect(parseSignedRequest(signed, ["another-secret"])).toBeNull();
    expect(parseSignedRequest("not-a-signed-request", [SECRET])).toBeNull();
    expect(parseSignedRequest("", [SECRET])).toBeNull();
    expect(parseSignedRequest(null, [SECRET])).toBeNull();
    expect(
      parseSignedRequest(signRequest({ user_id: "1", algorithm: "MD5" }, SECRET), [SECRET])
    ).toBeNull();
  });

  it("produces readable confirmation codes and status URLs", () => {
    const code = generateConfirmationCode(() => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(code).toBe("RF-ABCDE-FGHAB");
    expect(isConfirmationCode(code)).toBe(true);
    expect(isConfirmationCode("RF-ABCDE-FGH0O")).toBe(false);
    expect(buildDeletionStatusUrl("https://replyflow.example", code)).toBe(
      "https://replyflow.example/data-deletion?code=RF-ABCDE-FGHAB"
    );
    expect(generateConfirmationCode()).toMatch(/^RF-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  });
});

describe("POST /api/meta/data-deletion", () => {
  it("rejects requests that are not signed by the app", async () => {
    const response = await POST(formRequest("bad.request"));
    expect(response.status).toBe(400);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it("removes the Instagram connection and answers Meta with a status URL", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "acct_1", workspaceId: "ws_1", username: "kz3solucoes" },
    ]);
    const signed = signRequest({ user_id: "1789", algorithm: "HMAC-SHA256" }, SECRET);
    const response = await POST(formRequest(signed));
    const body = (await response.json()) as { url: string; confirmation_code: string };

    expect(response.status).toBe(200);
    expect(body.confirmation_code).toMatch(/^RF-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(body.url).toBe(
      `https://replyflow.example/data-deletion?code=${body.confirmation_code}`
    );
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { instagramId: "1789" } })
    );
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["acct_1"] } } });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws_1",
        actorUserId: null,
        action: "INSTAGRAM_DISCONNECTED",
        targetId: "acct_1",
        metadata: expect.objectContaining({
          reason: "META_DATA_DELETION_REQUEST",
          confirmationCode: body.confirmation_code,
        }),
      }),
    });
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws_1",
        source: "SYSTEM",
        level: "INFO",
        payload: expect.objectContaining({
          kind: "META_DATA_DELETION",
          confirmationCode: body.confirmation_code,
          userId: "1789",
          removedAccounts: ["kz3solucoes"],
        }),
      }),
    });
  });

  it("still records the request when nothing is connected for that user", async () => {
    const signed = signRequest({ user_id: "404", algorithm: "HMAC-SHA256" }, SECRET);
    const request = new NextRequest("https://replyflow.example/api/meta/data-deletion", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signed_request: signed }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: null,
        payload: expect.objectContaining({ userId: "404", removedAccounts: [] }),
      }),
    });
  });

  it("answers GET with a plain description instead of an error", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      endpoint: "meta-data-deletion-callback",
      instructions: "https://replyflow.example/data-deletion",
    });
  });
});

describe("deletion status lookup", () => {
  it("finds a request by confirmation code and ignores malformed codes", async () => {
    mocks.eventFindFirst.mockResolvedValue({
      createdAt: new Date("2026-09-12T20:00:00Z"),
      payload: { confirmationCode: "RF-ABCDE-FGHJK", removedAccounts: ["kz3solucoes"] },
    });
    expect(await findDeletionRequest("RF-ABCDE-FGHJK")).toEqual({
      code: "RF-ABCDE-FGHJK",
      receivedAt: new Date("2026-09-12T20:00:00Z"),
      removedAccounts: 1,
    });
    expect(mocks.eventFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          source: "SYSTEM",
          payload: { path: ["confirmationCode"], equals: "RF-ABCDE-FGHJK" },
        },
      })
    );

    mocks.eventFindFirst.mockClear();
    expect(await findDeletionRequest("'; drop table --")).toBeNull();
    expect(mocks.eventFindFirst).not.toHaveBeenCalled();
  });
});
