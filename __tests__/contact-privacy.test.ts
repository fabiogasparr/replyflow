import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, transaction } = vi.hoisted(() => ({
  mockPrisma: { $transaction: vi.fn() },
  transaction: {
    contact: { findFirst: vi.fn(), deleteMany: vi.fn() },
    dmLog: { findMany: vi.fn(), count: vi.fn() },
    processedComment: { findMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import {
  anonymizeContactPersonalData,
  ContactPrivacyError,
  getContactPrivacyExport,
} from "@/lib/contact-privacy";

const contact = {
  id: "contact_1",
  instagramAccountId: "account_1",
  instagramScopedId: "person_1",
  username: "maria",
  usernameObservedAt: new Date("2026-09-01T10:00:00Z"),
  tags: ["cliente"],
  notes: "Retornar",
  version: 4,
  firstSeenAt: new Date("2026-09-01T10:00:00Z"),
  lastSeenAt: new Date("2026-09-10T10:00:00Z"),
  createdAt: new Date("2026-09-01T10:00:00Z"),
  updatedAt: new Date("2026-09-10T10:00:00Z"),
  workspace: { id: "workspace_1", name: "Loja" },
  instagramAccount: { id: "account_1", username: "minhaloja" },
  conversations: [{ id: "conversation_1" }],
  _count: { conversations: 1 },
};

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(
    async (callback: (client: typeof transaction) => unknown) => callback(transaction),
  );
  transaction.contact.findFirst.mockResolvedValue(contact);
  transaction.contact.deleteMany.mockResolvedValue({ count: 1 });
  transaction.dmLog.findMany.mockResolvedValue([{ id: "log_1", commenterId: "person_1", commentId: "comment_1" }]);
  transaction.processedComment.findMany.mockResolvedValue([]);
  transaction.dmLog.count.mockResolvedValue(3);
  transaction.$executeRaw.mockResolvedValue(3);
  transaction.auditEvent.create.mockResolvedValue({ id: "audit_1" });
});

describe("contact privacy export", () => {
  it("exports only the scoped contact history and records a metadata-only audit", async () => {
    const result = await getContactPrivacyExport({
      workspaceId: "workspace_1",
      contactId: "contact_1",
      actorUserId: "owner_1",
    });

    expect(transaction.contact.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "contact_1",
        workspaceId: "workspace_1",
        instagramAccount: { workspaceId: "workspace_1" },
      },
      select: expect.not.objectContaining({ version: true }),
    }));
    expect(transaction.dmLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        workspaceId: "workspace_1",
        instagramAccountId: "account_1",
        commenterId: "person_1",
        instagramAccount: { workspaceId: "workspace_1" },
        automation: { workspaceId: "workspace_1", instagramAccountId: "account_1" },
      },
    }));
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        actorUserId: "owner_1",
        action: "CONTACT_DATA_EXPORTED",
        targetType: "Contact",
        targetId: "contact_1",
        metadata: { interactionCount: 1, conversationCount: 1, processedCommentCount: 0 },
      },
    });
    expect(result).toMatchObject({
      format: "replyflow-contact-data-export",
      version: 1,
      contact: { id: "contact_1", username: "maria" },
      automationInteractions: [{ id: "log_1" }],
    });
    expect(JSON.stringify(result)).not.toContain("accessToken");
  });

  it("does not create an audit or read logs for a missing/foreign contact", async () => {
    transaction.contact.findFirst.mockResolvedValue(null);

    await expect(getContactPrivacyExport({
      workspaceId: "workspace_1",
      contactId: "foreign",
      actorUserId: "owner_1",
    })).rejects.toMatchObject({ status: 404, code: "CONTACT_NOT_FOUND" });

    expect(transaction.dmLog.findMany).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe("contact privacy anonymization", () => {
  it("anonymizes identifying log fields, deletes the versioned profile and audits counts", async () => {
    const result = await anonymizeContactPersonalData({
      workspaceId: "workspace_1",
      contactId: "contact_1",
      actorUserId: "owner_1",
      version: 4,
      confirmation: "EXCLUIR @maria",
    });

    expect(transaction.dmLog.count).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        instagramAccountId: "account_1",
        commenterId: "person_1",
        instagramAccount: { workspaceId: "workspace_1" },
        automation: { workspaceId: "workspace_1", instagramAccountId: "account_1" },
      },
    });
    const query = transaction.$executeRaw.mock.calls
      .map(([value]) => value)
      .find((value) => value.strings.join("?").includes('UPDATE "DmLog" AS log'));
    expect(query).toBeDefined();
    const sql = query.strings.join("?");
    expect(sql).toContain('UPDATE "DmLog" AS log');
    expect(sql).toContain('"commenterName" = NULL');
    expect(sql).toContain('"sourceEventId" = NULL');
    expect(sql).toContain('automation."workspaceId" =');
    expect(sql).toContain('account."workspaceId" =');
    expect(query.values).toEqual(expect.arrayContaining([
      "workspace_1", "account_1", "person_1",
    ]));
    expect(query.values.some((value: unknown) => typeof value === "string" && value.startsWith("deleted:"))).toBe(true);
    expect(transaction.contact.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "contact_1",
        workspaceId: "workspace_1",
        instagramAccount: { workspaceId: "workspace_1" },
        version: 4,
      },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace_1",
        actorUserId: "owner_1",
        action: "CONTACT_DATA_ANONYMIZED",
        targetType: "Contact",
        targetId: "contact_1",
        metadata: {
          interactionsAnonymized: 3,
          webhookEventsRemoved: 3,
          conversationsRemoved: 1,
          aggregateDeliveryMetricsRetained: true,
          technicalDeduplicationIdsRetained: true,
        },
      },
    });
    expect(result).toEqual({
      interactionsAnonymized: 3,
      webhookEventsRemoved: 3,
      conversationsRemoved: 1,
    });
  });

  it.each([
    { version: 3, confirmation: "EXCLUIR @maria", status: 409, code: "CONTACT_VERSION_CONFLICT" },
    { version: 4, confirmation: "EXCLUIR @outra", status: 400, code: "INVALID_CONFIRMATION" },
  ])("blocks mutation before touching logs for an invalid guard: $code", async (guard) => {
    await expect(anonymizeContactPersonalData({
      workspaceId: "workspace_1",
      contactId: "contact_1",
      actorUserId: "owner_1",
      version: guard.version,
      confirmation: guard.confirmation,
    })).rejects.toMatchObject({ status: guard.status, code: guard.code });

    expect(transaction.dmLog.count).not.toHaveBeenCalled();
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
    expect(transaction.contact.deleteMany).not.toHaveBeenCalled();
  });

  it("turns a concurrent delete/update into a conflict and never writes the audit", async () => {
    transaction.contact.deleteMany.mockResolvedValue({ count: 0 });

    await expect(anonymizeContactPersonalData({
      workspaceId: "workspace_1",
      contactId: "contact_1",
      actorUserId: "owner_1",
      version: 4,
      confirmation: "EXCLUIR @maria",
    })).rejects.toBeInstanceOf(ContactPrivacyError);

    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });
});
