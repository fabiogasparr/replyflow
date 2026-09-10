import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentWorkspaceContext, mockPrisma, transaction } = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  mockPrisma: {
    contact: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    instagramAccount: { findMany: vi.fn() },
    automation: { findMany: vi.fn() },
    dmLog: { findMany: vi.fn(), count: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  transaction: {
    contact: { updateMany: vi.fn(), findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext }));

import { GET as listContacts } from "@/app/api/contacts/route";
import { GET as getContact, PATCH } from "@/app/api/contacts/[id]/route";
import { GET as getInteractions } from "@/app/api/contacts/[id]/interactions/route";

const contact = {
  id: "contact_1",
  instagramAccountId: "account_1",
  instagramScopedId: "ig_person_1",
  username: "maria",
  tags: ["Cliente"],
  notes: "Retornar amanhã",
  version: 2,
  firstSeenAt: new Date("2026-09-01T12:00:00Z"),
  lastSeenAt: new Date("2026-09-04T12:00:00Z"),
  createdAt: new Date("2026-09-01T12:00:00Z"),
  updatedAt: new Date("2026-09-04T12:00:00Z"),
  instagramAccount: { id: "account_1", username: "minhaloja" },
};

function context(role: "OWNER" | "ADMIN" | "MEMBER" = "OWNER") {
  return { userId: "user_actor", workspaceId: "workspace_1", role };
}

function route(id = "contact_1") {
  return { params: Promise.resolve({ id }) };
}

function request(path = "", body?: unknown) {
  return new NextRequest(`http://localhost/api/contacts${path}`, {
    ...(body === undefined ? {} : {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  getCurrentWorkspaceContext.mockResolvedValue(context());
  mockPrisma.contact.findMany.mockResolvedValue([]);
  mockPrisma.contact.count.mockResolvedValue(0);
  mockPrisma.contact.findFirst.mockResolvedValue(contact);
  mockPrisma.instagramAccount.findMany.mockResolvedValue([]);
  mockPrisma.automation.findMany.mockResolvedValue([]);
  mockPrisma.$queryRaw
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ total: 0 }]);
  mockPrisma.dmLog.findMany.mockResolvedValue([]);
  mockPrisma.dmLog.count.mockResolvedValue(0);
  transaction.contact.updateMany.mockResolvedValue({ count: 1 });
  transaction.contact.findFirst.mockResolvedValue({ ...contact, version: 3 });
  transaction.auditEvent.create.mockResolvedValue({ id: "audit_1" });
  mockPrisma.$transaction.mockImplementation(
    async (callback: (client: typeof transaction) => unknown) => callback(transaction)
  );
});

describe("contacts authorization and scoped reads", () => {
  it("rejects unauthenticated access to every endpoint before querying contacts", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(null);

    const responses = await Promise.all([
      listContacts(request()),
      getContact(request("/contact_1"), route()),
      getInteractions(request("/contact_1/interactions"), route()),
      PATCH(request("/contact_1", { version: 2, notes: "Mensagem" }), route()),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
    expect(mockPrisma.contact.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.contact.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows members to read contacts without notes in the list or account credentials", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("MEMBER"));

    const response = await listContacts(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { contacts: [], total: 0, page: 1, pageSize: 25, accounts: [], automations: [], canEdit: false },
    });
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockPrisma.instagramAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: "workspace_1" },
      select: { id: true, username: true },
    }));
    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: "workspace_1" },
      select: { id: true, name: true, instagramAccountId: true },
    }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("combines identity and activity filters as parameterized SQL", async () => {
    const response = await listContacts(request("?q=%40MARIA&instagramAccountId=account_2&tag=%20Cliente%20&automationId=automation_2&origin=COMMENT&engagement=SENT&activeWithinDays=30&page=2&pageSize=10"));

    expect(response.status).toBe(200);
    const queries = mockPrisma.$queryRaw.mock.calls.map(([query]) => query);
    const sql = queries.map((query) => query.strings.join("?")).join("\n");
    const values = queries.flatMap((query) => query.values);
    expect(sql).toContain("EXISTS");
    expect(sql).toContain('log."triggerType"::text');
    expect(sql).toContain('log."status"::text');
    expect(values).toEqual(expect.arrayContaining([
      "workspace_1", "account_2", "Cliente", "MARIA", "@MARIA",
      "automation_2", "COMMENT", "SENT", 10,
    ]));
    expect(sql).not.toContain("automation_2");
  });

  it("accepts search as an alias and all accounts without removing workspace scope", async () => {
    await listContacts(request("?search=maria&instagramAccountId=all"));

    const query = mockPrisma.$queryRaw.mock.calls[0][0];
    expect(query.values).toContain("workspace_1");
    expect(query.values).toContain("maria");
    expect(query.values).not.toContain("all");
  });

  it.each(["page=0", "page=NaN", "page=1.5", "pageSize=101", "pageSize=-1", "page=1000001"])(
    "rejects invalid or unbounded pagination: %s",
    async (query) => {
      const response = await listContacts(request(`?${query}`));
      expect(response.status).toBe(400);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    }
  );

  it.each([
    "origin=POSTBACK",
    "engagement=UNKNOWN",
    "activeWithinDays=14",
    "activeWithinDays=-7",
  ])("rejects unsupported segment values: %s", async (query) => {
    const response = await listContacts(request(`?${query}`));
    expect(response.status).toBe(400);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("loads selected contacts with a second explicit workspace boundary", async () => {
    mockPrisma.$queryRaw.mockReset();
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ id: "contact_1" }])
      .mockResolvedValueOnce([{ total: 1 }]);
    mockPrisma.contact.findMany.mockResolvedValue([{ ...contact, notes: undefined }]);

    const response = await listContacts(request("?origin=MESSAGE"));

    expect(response.status).toBe(200);
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["contact_1"] },
        workspaceId: "workspace_1",
        instagramAccount: { workspaceId: "workspace_1" },
      },
      select: expect.not.objectContaining({ notes: true }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { total: 1, contacts: [{ id: "contact_1" }] },
    });
  });

  it("returns detail and edit capability to an admin with an explicit safe select", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("ADMIN"));

    const response = await getContact(request("/contact_1"), route());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { contact: { id: "contact_1", notes: "Retornar amanhã", version: 2 }, canEdit: true },
    });
    expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "contact_1", workspaceId: "workspace_1", instagramAccount: { workspaceId: "workspace_1" } },
      select: expect.objectContaining({ notes: true, instagramAccount: { select: { id: true, username: true } } }),
    }));
  });

  it("returns 404 for a contact outside the workspace and never reads its interactions", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);

    const responses = await Promise.all([
      getContact(request("/foreign"), route("foreign")),
      getInteractions(request("/foreign/interactions"), route("foreign")),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404]);
    expect(mockPrisma.dmLog.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.count).not.toHaveBeenCalled();
    for (const [query] of mockPrisma.contact.findFirst.mock.calls) {
      expect(query.where).toMatchObject({ id: "foreign", workspaceId: "workspace_1" });
    }
  });

  it("looks up history using the workspace/account/scoped-user identity and scoped campaign", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("MEMBER"));

    const response = await getInteractions(request("/contact_1/interactions?page=3&pageSize=5"), route());

    expect(response.status).toBe(200);
    const where = {
      workspaceId: "workspace_1",
      instagramAccountId: "account_1",
      commenterId: "ig_person_1",
      instagramAccount: { workspaceId: "workspace_1" },
      automation: { workspaceId: "workspace_1", instagramAccountId: "account_1" },
    };
    expect(mockPrisma.dmLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where, skip: 10, take: 5,
      select: {
        id: true, commentText: true, matchedKeyword: true, status: true,
        createdAt: true, dmSentAt: true, automation: { select: { id: true, name: true } },
      },
    }));
    expect(mockPrisma.dmLog.count).toHaveBeenCalledWith({ where });
    await expect(response.json()).resolves.toMatchObject({ data: { interactions: [], total: 0, page: 3, pageSize: 5 } });
  });

  it("rejects invalid history pagination before looking up the contact", async () => {
    const response = await getInteractions(request("/contact_1/interactions?pageSize=101"), route());
    expect(response.status).toBe(400);
    expect(mockPrisma.contact.findFirst).not.toHaveBeenCalled();
  });
});

describe("contact editing and audit", () => {
  it("forbids members from editing before reading or mutating contact data", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("MEMBER"));

    const response = await PATCH(request("/contact_1", { version: 2, notes: "Trocar" }), route());

    expect(response.status).toBe(403);
    expect(mockPrisma.contact.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "ADMIN"] as const)("allows %s to normalize edits and audit only changed field names", async (role) => {
    getCurrentWorkspaceContext.mockResolvedValue(context(role));

    const response = await PATCH(request("/contact_1", {
      version: 2,
      tags: [" VIP ", "vip", "Cliente"],
      notes: "  Informação interna  ",
    }), route());

    expect(response.status).toBe(200);
    expect(transaction.contact.updateMany).toHaveBeenCalledWith({
      where: {
        id: "contact_1", workspaceId: "workspace_1", version: 2,
        instagramAccount: { workspaceId: "workspace_1" },
      },
      data: { tags: ["VIP", "Cliente"], notes: "Informação interna", version: { increment: 1 } },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1", actorUserId: "user_actor", action: "CONTACT_UPDATED",
        targetType: "Contact", targetId: "contact_1", metadata: { fields: ["tags", "notes"] },
      },
    });
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { contact: { version: 3 } } });
  });

  it("supports clearing notes without changing tags", async () => {
    await PATCH(request("/contact_1", { version: 2, notes: "   " }), route());

    expect(transaction.contact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { notes: null, version: { increment: 1 } },
    }));
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: { fields: ["notes"] } }),
    }));
  });

  it.each([
    { notes: "missing version" },
    { version: 2 },
    { version: -1, notes: "Inválida" },
    { version: 2.5, notes: "Inválida" },
    { version: 2, tags: Array.from({ length: 11 }, (_, index) => `tag${index}`) },
    { version: 2, tags: ["a".repeat(31)] },
    { version: 2, tags: [" "] },
    { version: 2, notes: "a".repeat(5001) },
    { version: 2, notes: "valid", workspaceId: "workspace_other" },
  ])("rejects malformed, oversized or unexpected updates %#", async (body) => {
    const response = await PATCH(request("/contact_1", body), route());

    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const malformed = new NextRequest("http://localhost/api/contacts/contact_1", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{",
    });
    const response = await PATCH(malformed, route());
    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a stale version with 409 and leaves the newer notes untouched", async () => {
    const saved = { notes: "Anotação mais recente", version: 3 };
    transaction.contact.updateMany.mockImplementation(async ({ where, data }) => {
      if (where.version !== saved.version) return { count: 0 };
      saved.notes = data.notes;
      saved.version += data.version.increment;
      return { count: 1 };
    });
    transaction.contact.findFirst.mockResolvedValue({ id: "contact_1" });

    const response = await PATCH(request("/contact_1", { version: 2, notes: "Rascunho desatualizado" }), route());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ success: false, code: "CONTACT_VERSION_CONFLICT" });
    expect(saved).toEqual({ notes: "Anotação mais recente", version: 3 });
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
    expect(transaction.contact.findFirst).toHaveBeenCalledWith({
      where: { id: "contact_1", workspaceId: "workspace_1", instagramAccount: { workspaceId: "workspace_1" } },
      select: { id: true },
    });
  });

  it("returns 404 instead of a version conflict for a foreign or missing contact", async () => {
    transaction.contact.updateMany.mockResolvedValue({ count: 0 });
    transaction.contact.findFirst.mockResolvedValue(null);

    const response = await PATCH(request("/foreign", { version: 2, tags: [] }), route("foreign"));

    expect(response.status).toBe(404);
    expect(transaction.contact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "foreign", workspaceId: "workspace_1", version: 2 }),
    }));
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  it("aborts the transaction when audit persistence fails instead of completing the edit", async () => {
    transaction.auditEvent.create.mockRejectedValue(new Error("audit unavailable"));
    const saved = { notes: contact.notes, version: contact.version };
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      const pending = { ...saved };
      transaction.contact.updateMany.mockImplementation(async ({ data }) => {
        pending.notes = data.notes;
        pending.version += data.version.increment;
        return { count: 1 };
      });
      const result = await callback(transaction);
      Object.assign(saved, pending);
      return result;
    });

    await expect(PATCH(request("/contact_1", { version: 2, notes: "Alteração" }), route()))
      .rejects.toThrow("audit unavailable");

    expect(transaction.contact.updateMany).toHaveBeenCalledOnce();
    expect(transaction.auditEvent.create).toHaveBeenCalledOnce();
    expect(saved).toEqual({ notes: contact.notes, version: contact.version });
  });
});
