CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_workspaceId_createdAt_idx"
ON "AuditEvent"("workspaceId", "createdAt");

CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");

CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
