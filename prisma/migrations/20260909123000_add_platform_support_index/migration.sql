-- CreateIndex
CREATE INDEX "DmLog_status_updatedAt_id_idx"
ON "DmLog"("status", "updatedAt", "id");
