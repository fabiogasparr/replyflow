ALTER TABLE "Automation"
  ADD COLUMN "lastRunAt" TIMESTAMP(3),
  ADD COLUMN "lastSuccessAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorKind" TEXT,
  ADD COLUMN "lastErrorMessage" TEXT,
  ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Automation_workspaceId_lastErrorAt_idx"
  ON "Automation"("workspaceId", "lastErrorAt");
