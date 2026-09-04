-- Archive workspaces without deleting customer history. Active automations are
-- paused by the application in the same transaction that sets this timestamp.
ALTER TABLE "Workspace" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Workspace_archivedAt_idx" ON "Workspace"("archivedAt");
