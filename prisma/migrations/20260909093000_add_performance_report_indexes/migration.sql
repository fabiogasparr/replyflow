-- AddIndex
CREATE INDEX "DmLog_workspaceId_createdAt_idx" ON "DmLog"("workspaceId", "createdAt");

-- AddIndex
CREATE INDEX "DmLog_workspaceId_instagramAccountId_createdAt_idx" ON "DmLog"("workspaceId", "instagramAccountId", "createdAt");

-- AddIndex
CREATE INDEX "DmLog_workspaceId_automationId_createdAt_idx" ON "DmLog"("workspaceId", "automationId", "createdAt");

-- AddIndex
CREATE INDEX "LinkClick_workspaceId_instagramAccountId_createdAt_idx" ON "LinkClick"("workspaceId", "instagramAccountId", "createdAt");

-- AddIndex
CREATE INDEX "LinkClick_workspaceId_automationId_createdAt_idx" ON "LinkClick"("workspaceId", "automationId", "createdAt");
