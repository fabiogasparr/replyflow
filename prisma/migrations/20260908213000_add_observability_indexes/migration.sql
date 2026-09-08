-- Global operational dashboards filter recent records by time before grouping
-- them. These additive indexes avoid sequential scans as tenant history grows.
CREATE INDEX "Session_expires_idx" ON "Session"("expires");
CREATE INDEX "InstagramAccount_tokenExpiresAt_idx"
  ON "InstagramAccount"("tokenExpiresAt");
CREATE INDEX "Automation_lastErrorAt_idx" ON "Automation"("lastErrorAt");
CREATE INDEX "DmLog_updatedAt_idx" ON "DmLog"("updatedAt");
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");
CREATE INDEX "BillingEvent_createdAt_idx" ON "BillingEvent"("createdAt");
