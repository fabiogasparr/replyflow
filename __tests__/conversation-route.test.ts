import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const transaction = {
    conversation: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditEvent: { create: vi.fn() },
  };
  return {
    context: vi.fn(),
    account: vi.fn(),
    permission: vi.fn(),
    getConversations: vi.fn(),
    getConversationMessages: vi.fn(),
    sendDirectMessage: vi.fn(),
    syncConversationSnapshots: vi.fn(),
    transaction,
    prisma: {
      workspaceMember: { findMany: vi.fn(), findFirst: vi.fn() },
      conversation: { findFirst: vi.fn(), updateMany: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: mocks.context }));
vi.mock("@/lib/workspace-permissions", () => ({ hasWorkspacePermission: mocks.permission }));
vi.mock("@/lib/instagram-accounts", () => ({ getWorkspaceInstagramAccount: mocks.account }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "decrypted-token" }));
vi.mock("@/lib/meta/client", () => ({
  getConversations: mocks.getConversations,
  getConversationMessages: mocks.getConversationMessages,
  sendDirectMessage: mocks.sendDirectMessage,
  MetaApiError: class MetaApiError extends Error {},
}));
vi.mock("@/lib/conversations", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/conversations")>();
  return { ...original, syncConversationSnapshots: mocks.syncConversationSnapshots };
});

import { GET as listConversations, POST as sendMessage } from "@/app/api/instagram/conversations/route";
import { GET as getThread, PATCH as updateConversation } from "@/app/api/instagram/conversations/[id]/route";

const workspace = {
  userId: "user_1",
  workspaceId: "workspace_1",
  role: "ADMIN" as const,
  workspace: { id: "workspace_1", name: "Empresa" },
};
const account = {
  id: "account_1",
  workspaceId: "workspace_1",
  instagramId: "ig_business_1",
  username: "empresa",
  accessToken: "encrypted-token",
};
const state = {
  id: "conversation_1",
  metaConversationId: "meta_conversation_1",
  status: "OPEN" as const,
  priority: "NORMAL" as const,
  assignedMemberId: null,
  notes: null,
  version: 0,
  lastInboundAt: new Date("2026-09-05T12:00:00Z"),
  lastSyncedAt: new Date("2026-09-05T12:01:00Z"),
  assignedMember: null,
};

function request(path = "", init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost/api/instagram/conversations${path}`, init);
}

function route(id = "meta_conversation_1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue(workspace);
  mocks.account.mockResolvedValue(account);
  mocks.permission.mockReturnValue(true);
  mocks.prisma.workspaceMember.findMany.mockResolvedValue([]);
  mocks.prisma.workspaceMember.findFirst.mockResolvedValue({ id: "member_1" });
  mocks.prisma.conversation.findFirst.mockResolvedValue({ lastInboundAt: state.lastInboundAt });
  mocks.prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
  mocks.syncConversationSnapshots.mockResolvedValue([state]);
  mocks.getConversations.mockResolvedValue([]);
  mocks.getConversationMessages.mockResolvedValue([]);
  mocks.sendDirectMessage.mockResolvedValue({ recipient_id: "person_1", message_id: "message_1" });
  mocks.transaction.conversation.findFirst.mockResolvedValue({ id: "conversation_1" });
  mocks.transaction.conversation.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.conversation.update.mockResolvedValue({});
  mocks.transaction.auditEvent.create.mockResolvedValue({});
  mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.transaction));
});

describe("conversation list synchronization", () => {
  it("requires authentication before reading an Instagram account", async () => {
    mocks.context.mockResolvedValue(null);
    const response = await listConversations(request("?instagramAccountId=account_1"));
    expect(response.status).toBe(401);
    expect(mocks.account).not.toHaveBeenCalled();
  });

  it("projects Meta conversations into scoped team state", async () => {
    mocks.getConversations.mockResolvedValue([{
      id: "meta_conversation_1",
      updated_time: "2026-09-05T12:00:00Z",
      participants: { data: [
        { id: "ig_business_1", username: "empresa" },
        { id: "person_1", username: "maria" },
      ] },
      messages: { data: [{
        id: "message_1",
        message: "Olá",
        from: { id: "person_1" },
        created_time: "2026-09-05T12:00:00Z",
      }] },
    }]);
    mocks.prisma.workspaceMember.findMany.mockResolvedValue([{
      id: "member_1", role: "ADMIN", user: { id: "user_1", name: "Ana", email: "ana@example.com" },
    }]);

    const response = await listConversations(request("?instagramAccountId=account_1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.account).toHaveBeenCalledWith("workspace_1", "account_1");
    expect(mocks.syncConversationSnapshots).toHaveBeenCalledWith("workspace_1", "account_1", [{
      metaConversationId: "meta_conversation_1",
      contact: { instagramScopedId: "person_1", username: "maria" },
      updatedTime: "2026-09-05T12:00:00Z",
      lastMessage: { text: "Olá", fromMe: false, createdTime: "2026-09-05T12:00:00Z" },
    }]);
    expect(payload.data).toMatchObject({
      canReply: true,
      conversations: [{
        id: "meta_conversation_1",
        contact: { id: "person_1", username: "maria" },
        state: { id: "conversation_1", status: "OPEN", lastInboundAt: "2026-09-05T12:00:00.000Z" },
      }],
      members: [{ id: "member_1" }],
    });
  });
});

describe("conversation history and messaging window", () => {
  it("keeps messages chronological and updates only the scoped inbound window", async () => {
    const future = new Date(Date.now() - 30 * 60 * 1_000).toISOString();
    mocks.getConversationMessages.mockResolvedValue([
      { id: "new", message: "Resposta", from: { id: "ig_business_1" }, created_time: new Date().toISOString() },
      { id: "inbound", message: "Preciso de ajuda", from: { id: "person_1", username: "maria" }, created_time: future },
    ]);
    mocks.prisma.conversation.findFirst.mockResolvedValue({ lastInboundAt: new Date(future) });

    const response = await getThread(request("/meta_conversation_1?instagramAccountId=account_1"), route());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.messages.map((message: { id: string }) => message.id)).toEqual(["inbound", "new"]);
    expect(payload.data.messagingWindow).toMatchObject({ isOpen: true, lastInboundAt: future });
    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        instagramAccountId: "account_1",
        metaConversationId: "meta_conversation_1",
        OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: new Date(future) } }],
      },
      data: { lastInboundAt: new Date(future), lastSyncedAt: expect.any(Date) },
    });
  });
});

describe("conversation team workflow", () => {
  it("validates an assignee inside the active workspace and audits field names only", async () => {
    mocks.transaction.conversation.findFirst
      .mockResolvedValueOnce({ id: "conversation_1" })
      .mockResolvedValueOnce({ ...state, assignedMemberId: "member_1", version: 1 });

    const response = await updateConversation(request(
      "/meta_conversation_1?instagramAccountId=account_1",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 0, status: "PENDING", assignedMemberId: "member_1", notes: " Retornar amanhã " }) },
    ), route());

    expect(response.status).toBe(200);
    expect(mocks.prisma.workspaceMember.findFirst).toHaveBeenCalledWith({
      where: { id: "member_1", workspaceId: "workspace_1" }, select: { id: true },
    });
    expect(mocks.transaction.conversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "conversation_1", workspaceId: "workspace_1", instagramAccountId: "account_1", version: 0 }),
      data: expect.objectContaining({ status: "PENDING", assignedMemberId: "member_1", notes: "Retornar amanhã", version: { increment: 1 } }),
    }));
    expect(mocks.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "CONVERSATION_UPDATED",
        metadata: { fields: ["status", "assignedMemberId", "notes"] },
      }),
    });
  });

  it("rejects an assignee from another workspace before mutating", async () => {
    mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);
    const response = await updateConversation(request(
      "/meta_conversation_1?instagramAccountId=account_1",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 0, assignedMemberId: "foreign_member" }) },
    ), route());
    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 409 for a stale state version", async () => {
    mocks.transaction.conversation.updateMany.mockResolvedValue({ count: 0 });
    const response = await updateConversation(request(
      "/meta_conversation_1?instagramAccountId=account_1",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 0, priority: "HIGH" }) },
    ), route());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "CONVERSATION_VERSION_CONFLICT" });
    expect(mocks.transaction.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe("sending replies", () => {
  it("blocks malformed and oversized messages before calling Meta", async () => {
    const response = await sendMessage(request("", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId: "account_1", recipientId: "person_1", text: "a".repeat(1001) }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("records successful Meta replies without storing their body in audit metadata", async () => {
    const response = await sendMessage(request("", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId: "account_1", recipientId: "person_1", conversationId: "meta_conversation_1", text: "Olá, Maria" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.sendDirectMessage).toHaveBeenCalledWith("decrypted-token", "ig_business_1", "person_1", "Olá, Maria");
    expect(mocks.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_1",
        action: "CONVERSATION_MESSAGE_SENT",
        metadata: { channel: "INSTAGRAM" },
      }),
    });
  });

  it("enforces the inbox permission", async () => {
    mocks.permission.mockReturnValue(false);
    const response = await sendMessage(request("", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId: "account_1", recipientId: "person_1", text: "Olá" }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.account).not.toHaveBeenCalled();
  });
});
