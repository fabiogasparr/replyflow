-- AlterTable
ALTER TABLE "Automation" ADD COLUMN "dmMessages" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Automation" ADD COLUMN "humanDelayMinSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Automation" ADD COLUMN "humanDelayMaxSeconds" INTEGER NOT NULL DEFAULT 0;
