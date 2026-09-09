-- AlterTable
ALTER TABLE "Workspace"
ADD COLUMN "reportBrandName" TEXT,
ADD COLUMN "reportBrandColor" TEXT NOT NULL DEFAULT '#112620';

-- AlterTable
ALTER TABLE "Automation"
ADD COLUMN "reportSharePeriodDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "reportSharePublishedAt" TIMESTAMP(3),
ADD COLUMN "reportShareRevokedAt" TIMESTAMP(3);

ALTER TABLE "Automation"
ALTER COLUMN "reportShareEnabled" SET DEFAULT false;

-- Existing public links remain valid and receive an approximate publication
-- timestamp. New campaigns start private until a manager publishes a report.
UPDATE "Automation"
SET "reportSharePublishedAt" = COALESCE("updatedAt", "createdAt")
WHERE "reportShareEnabled" = true
  AND "reportShareSlug" IS NOT NULL;

-- CheckConstraints
ALTER TABLE "Workspace"
ADD CONSTRAINT "Workspace_reportBrandColor_check"
CHECK ("reportBrandColor" ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE "Automation"
ADD CONSTRAINT "Automation_reportSharePeriodDays_check"
CHECK ("reportSharePeriodDays" IN (7, 30, 90));
