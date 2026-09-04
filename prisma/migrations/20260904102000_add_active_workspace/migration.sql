-- Persist the workspace a user selected while keeping access controlled by
-- WorkspaceMember. The application validates membership before every switch.
ALTER TABLE "User" ADD COLUMN "activeWorkspaceId" TEXT;

CREATE INDEX "User_activeWorkspaceId_idx" ON "User"("activeWorkspaceId");

ALTER TABLE "User"
ADD CONSTRAINT "User_activeWorkspaceId_fkey"
FOREIGN KEY ("activeWorkspaceId") REFERENCES "Workspace"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
