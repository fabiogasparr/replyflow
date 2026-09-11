import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentWorkspaceContext, getContactPrivacyExport, anonymizeContactPersonalData } = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  getContactPrivacyExport: vi.fn(),
  anonymizeContactPersonalData: vi.fn(),
}));

vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext }));
vi.mock("@/lib/contact-privacy", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/contact-privacy")>();
  return { ...original, getContactPrivacyExport, anonymizeContactPersonalData };
});

import { DELETE, GET } from "@/app/api/contacts/[id]/privacy/route";
import { ContactPrivacyError } from "@/lib/contact-privacy";

function context(role: "OWNER" | "ADMIN" | "MEMBER") {
  return { userId: "user_1", workspaceId: "workspace_1", role };
}

const route = { params: Promise.resolve({ id: "contact_1" }) };

beforeEach(() => {
  vi.resetAllMocks();
  getCurrentWorkspaceContext.mockResolvedValue(context("OWNER"));
  getContactPrivacyExport.mockResolvedValue({ format: "replyflow-contact-data-export", contact: { id: "contact_1" } });
  anonymizeContactPersonalData.mockResolvedValue({ interactionsAnonymized: 2, conversationsRemoved: 1 });
});

describe("contact privacy route", () => {
  it("requires authentication for export and erasure", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(null);
    const responses = await Promise.all([
      GET(new NextRequest("http://localhost/api/contacts/contact_1/privacy"), route),
      DELETE(new NextRequest("http://localhost/api/contacts/contact_1/privacy", {
        method: "DELETE",
        body: JSON.stringify({ version: 1, confirmation: "EXCLUIR @maria" }),
      }), route),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401]);
    expect(getContactPrivacyExport).not.toHaveBeenCalled();
    expect(anonymizeContactPersonalData).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "ADMIN"] as const)("lets %s export a private JSON attachment", async (role) => {
    getCurrentWorkspaceContext.mockResolvedValue(context(role));
    const response = await GET(new NextRequest("http://localhost/api/contacts/contact_1/privacy"), route);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("replyflow-dados-contato-contact_1.json");
    expect(getContactPrivacyExport).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      contactId: "contact_1",
      actorUserId: "user_1",
    });
  });

  it("blocks members from exporting before reading personal data", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("MEMBER"));
    const response = await GET(new NextRequest("http://localhost/api/contacts/contact_1/privacy"), route);
    expect(response.status).toBe(403);
    expect(getContactPrivacyExport).not.toHaveBeenCalled();
  });

  it("restricts erasure to the owner even when an admin can edit contacts", async () => {
    getCurrentWorkspaceContext.mockResolvedValue(context("ADMIN"));
    const response = await DELETE(new NextRequest("http://localhost/api/contacts/contact_1/privacy", {
      method: "DELETE",
      body: JSON.stringify({ version: 1, confirmation: "EXCLUIR @maria" }),
    }), route);
    expect(response.status).toBe(403);
    expect(anonymizeContactPersonalData).not.toHaveBeenCalled();
  });

  it("validates the exact erasure contract and forwards only trusted context", async () => {
    const response = await DELETE(new NextRequest("http://localhost/api/contacts/contact_1/privacy", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 4, confirmation: "EXCLUIR @maria" }),
    }), route);

    expect(response.status).toBe(200);
    expect(anonymizeContactPersonalData).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      contactId: "contact_1",
      actorUserId: "user_1",
      version: 4,
      confirmation: "EXCLUIR @maria",
    });
  });

  it.each([
    "{",
    JSON.stringify({ confirmation: "EXCLUIR @maria" }),
    JSON.stringify({ version: 1, confirmation: "EXCLUIR @maria", workspaceId: "other" }),
  ])("rejects malformed erasure input", async (body) => {
    const response = await DELETE(new NextRequest("http://localhost/api/contacts/contact_1/privacy", {
      method: "DELETE", body,
    }), route);
    expect(response.status).toBe(400);
    expect(anonymizeContactPersonalData).not.toHaveBeenCalled();
  });

  it("returns stable service error codes without leaking internals", async () => {
    anonymizeContactPersonalData.mockRejectedValue(
      new ContactPrivacyError(409, "CONTACT_VERSION_CONFLICT", "Recarregue os dados."),
    );
    const response = await DELETE(new NextRequest("http://localhost/api/contacts/contact_1/privacy", {
      method: "DELETE",
      body: JSON.stringify({ version: 4, confirmation: "EXCLUIR @maria" }),
    }), route);
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: "CONTACT_VERSION_CONFLICT",
      error: "Recarregue os dados.",
    });
    expect(response.status).toBe(409);
  });
});
