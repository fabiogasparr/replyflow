import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, transaction } = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    conversation: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) => callback(transaction)),
    },
  };
});

vi.mock("@/lib/db/client", () => ({ prisma }));

import { syncConversationSnapshots } from "@/lib/conversations";

beforeEach(() => {
  vi.clearAllMocks();
  transaction.$queryRaw.mockResolvedValue([{ id: "contact_1" }]);
  transaction.conversation.upsert.mockResolvedValue({ id: "conversation_1" });
  transaction.conversation.updateMany.mockResolvedValue({ count: 1 });
  transaction.conversation.findMany.mockResolvedValue([]);
});

describe("conversation projection", () => {
  it("keeps team fields outside polling writes and scopes every operation", async () => {
    await syncConversationSnapshots("workspace_1", "account_1", [{
      metaConversationId: "meta_1",
      contact: { instagramScopedId: "person_1", username: "maria" },
      updatedTime: "2026-09-05T10:00:00Z",
      lastMessage: { text: "Olá", fromMe: false, createdTime: "2026-09-05T10:00:00Z" },
    }]);

    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.conversation.upsert).toHaveBeenCalledWith({
      where: {
        workspaceId_instagramAccountId_metaConversationId: {
          workspaceId: "workspace_1",
          instagramAccountId: "account_1",
          metaConversationId: "meta_1",
        },
      },
      create: expect.objectContaining({
        workspaceId: "workspace_1",
        instagramAccountId: "account_1",
        contactId: "contact_1",
        metaConversationId: "meta_1",
        lastMessageText: "Olá",
        lastMessageFromMe: false,
      }),
      update: { contactId: "contact_1", lastSyncedAt: expect.any(Date) },
      select: { id: true },
    });
    expect(transaction.conversation.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "conversation_1",
        workspaceId: "workspace_1",
        OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: new Date("2026-09-05T10:00:00Z") } }],
      },
      data: {
        lastMessageText: "Olá",
        lastMessageAt: new Date("2026-09-05T10:00:00Z"),
        lastMessageFromMe: false,
      },
    });
    expect(transaction.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        workspaceId: "workspace_1",
        instagramAccountId: "account_1",
        metaConversationId: { in: ["meta_1"] },
      },
    }));
    const serializedCalls = JSON.stringify(transaction.conversation.updateMany.mock.calls);
    expect(serializedCalls).not.toContain("notes");
    expect(serializedCalls).not.toContain("status");
    expect(serializedCalls).not.toContain("priority");
    expect(serializedCalls).not.toContain("assignedMemberId");
    expect(serializedCalls).not.toContain("version");
  });

  it("ignores Meta rows without a conversation or recipient identity", async () => {
    const result = await syncConversationSnapshots("workspace_1", "account_1", [
      { metaConversationId: "", contact: { instagramScopedId: "person", username: null }, updatedTime: null, lastMessage: null },
      { metaConversationId: "meta", contact: { instagramScopedId: "", username: null }, updatedTime: null, lastMessage: null },
    ]);
    expect(result).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
