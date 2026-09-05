BEGIN;

CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED');
CREATE TYPE "ConversationPriority" AS ENUM ('NORMAL', 'HIGH');

CREATE UNIQUE INDEX "Contact_id_workspaceId_instagramAccountId_key"
    ON "Contact"("id", "workspaceId", "instagramAccountId");
CREATE UNIQUE INDEX "WorkspaceMember_id_workspaceId_key"
    ON "WorkspaceMember"("id", "workspaceId");

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "metaConversationId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "ConversationPriority" NOT NULL DEFAULT 'NORMAL',
    "assignedMemberId" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "lastMessageText" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessageFromMe" BOOLEAN,
    "lastInboundAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Conversation_workspaceId_instagramAccountId_metaConversationId_key"
    ON "Conversation"("workspaceId", "instagramAccountId", "metaConversationId");
CREATE INDEX "Conversation_workspaceId_status_priority_lastMessageAt_idx"
    ON "Conversation"("workspaceId", "status", "priority", "lastMessageAt");
CREATE INDEX "Conversation_assignedMemberId_idx"
    ON "Conversation"("assignedMemberId");
CREATE INDEX "Conversation_contactId_idx"
    ON "Conversation"("contactId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_instagramAccountId_workspaceId_fkey"
    FOREIGN KEY ("instagramAccountId", "workspaceId")
    REFERENCES "InstagramAccount"("id", "workspaceId")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_workspaceId_instagramAccountId_fkey"
    FOREIGN KEY ("contactId", "workspaceId", "instagramAccountId")
    REFERENCES "Contact"("id", "workspaceId", "instagramAccountId")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedMemberId_workspaceId_fkey"
    FOREIGN KEY ("assignedMemberId", "workspaceId")
    REFERENCES "WorkspaceMember"("id", "workspaceId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
