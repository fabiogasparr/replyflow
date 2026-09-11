import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentWorkspaceContext, mockPrisma, transaction } = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  mockPrisma: {
    contactFieldDefinition: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  transaction: {
    $queryRaw: vi.fn(),
    contactFieldDefinition: {
      count: vi.fn(), aggregate: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn(),
    },
    contactFieldValue: { count: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext }));

import { GET, POST } from "@/app/api/contact-fields/route";
import { PATCH } from "@/app/api/contact-fields/[id]/route";

const field = {
  id: "field_1", name: "Etapa", type: "SELECT", options: ["Novo", "Cliente"],
  position: 0, isActive: true, createdAt: new Date(), updatedAt: new Date(), _count: { values: 2 },
};
const route = { params: Promise.resolve({ id: "field_1" }) };
function context(role: "OWNER" | "ADMIN" | "MEMBER" = "OWNER") {
  return { userId: "user_1", workspaceId: "workspace_1", role };
}
function request(method: "POST" | "PATCH", body: unknown) {
  return new NextRequest("http://localhost/api/contact-fields", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  getCurrentWorkspaceContext.mockResolvedValue(context());
  mockPrisma.contactFieldDefinition.findMany.mockResolvedValue([field]);
  mockPrisma.$transaction.mockImplementation(
    async (callback: (client: typeof transaction) => unknown) => callback(transaction),
  );
  transaction.$queryRaw.mockResolvedValue([{ id: "workspace_1" }]);
  transaction.contactFieldDefinition.count.mockResolvedValue(0);
  transaction.contactFieldDefinition.aggregate.mockResolvedValue({ _max: { position: null } });
  transaction.contactFieldDefinition.create.mockResolvedValue(field);
  transaction.contactFieldDefinition.findFirst.mockResolvedValue(field);
  transaction.contactFieldDefinition.update.mockResolvedValue(field);
  transaction.contactFieldValue.count.mockResolvedValue(0);
  transaction.auditEvent.create.mockResolvedValue({ id: "audit_1" });
});

describe("contact field definition routes", () => {
  it("requires authentication before listing or mutating definitions", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(null);
    const responses = await Promise.all([
      GET(),
      POST(request("POST", { name: "Cidade", type: "TEXT" })),
      PATCH(request("PATCH", { name: "Cidade" }), route),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    expect(mockPrisma.contactFieldDefinition.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("lets members list definitions but not configure them", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("MEMBER"));
    const list = await GET();
    const create = await POST(request("POST", { name: "Cidade", type: "TEXT" }));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ data: { canManage: false, fields: [{ id: "field_1" }] } });
    expect(create.status).toBe(403);
    expect(mockPrisma.contactFieldDefinition.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: "workspace_1" },
    }));
  });

  it.each(["OWNER", "ADMIN"] as const)("lets %s create a scoped, audited field", async (role) => {
    getCurrentWorkspaceContext.mockResolvedValue(context(role));
    const response = await POST(request("POST", {
      name: " Etapa comercial ", type: "SELECT", options: [" Novo ", "Cliente"],
    }));
    expect(response.status).toBe(201);
    const lock = transaction.$queryRaw.mock.calls[0][0];
    expect(lock.strings.join("?")).toContain('FROM "Workspace"');
    expect(lock.values).toContain("workspace_1");
    expect(transaction.contactFieldDefinition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workspaceId: "workspace_1", name: "Etapa comercial",
        normalizedName: "etapa comercial", type: "SELECT", options: ["Novo", "Cliente"], position: 0,
      }),
    }));
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "CONTACT_FIELD_CREATED", targetId: "field_1" }),
    }));
  });

  it("rejects malformed fields before starting a transaction", async () => {
    const response = await POST(request("POST", { name: "Etapa", type: "SELECT", options: [] }));
    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("enforces the active field limit under the workspace lock", async () => {
    transaction.contactFieldDefinition.count
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(20);
    const response = await POST(request("POST", { name: "Cidade", type: "TEXT" }));
    expect(response.status).toBe(409);
    expect(transaction.contactFieldDefinition.create).not.toHaveBeenCalled();
  });

  it("returns 404 for a definition outside the current workspace", async () => {
    transaction.contactFieldDefinition.findFirst.mockResolvedValue(null);
    const response = await PATCH(request("PATCH", { name: "Outro" }), route);
    expect(response.status).toBe(404);
    expect(transaction.contactFieldDefinition.update).not.toHaveBeenCalled();
  });

  it("does not remove selection options still used by contacts", async () => {
    transaction.contactFieldValue.count.mockResolvedValue(1);
    const response = await PATCH(request("PATCH", { options: ["Novo"] }), route);
    expect(response.status).toBe(409);
    expect(transaction.contactFieldValue.count).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1", fieldDefinitionId: "field_1", value: { notIn: ["Novo"] },
      },
    });
    expect(transaction.contactFieldDefinition.update).not.toHaveBeenCalled();
  });

  it("does not allow a selection field to lose all options", async () => {
    const response = await PATCH(request("PATCH", { options: [] }), route);
    expect(response.status).toBe(400);
    expect(transaction.contactFieldDefinition.update).not.toHaveBeenCalled();
  });

  it("soft-disables a field and audits only the changed property", async () => {
    const response = await PATCH(request("PATCH", { isActive: false }), route);
    expect(response.status).toBe(200);
    expect(transaction.contactFieldDefinition.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id_workspaceId: { id: "field_1", workspaceId: "workspace_1" } }, data: { isActive: false },
    }));
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "CONTACT_FIELD_UPDATED", metadata: { fields: ["isActive"] } }),
    }));
  });
});
