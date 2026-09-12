-- AlterEnum
ALTER TYPE "DmStatus" ADD VALUE 'SKIPPED_HUMAN_REVIEW';

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN "aiPublicReplyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Automation" ADD COLUMN "aiDmEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Automation" ADD COLUMN "aiInstructions" TEXT;
ALTER TABLE "Automation" ADD COLUMN "aiModerationEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Automation" ADD COLUMN "aiModerationSensitivity" TEXT NOT NULL DEFAULT 'HOSTILE';

-- AlterTable
ALTER TABLE "DmLog" ADD COLUMN "aiSentiment" TEXT;
ALTER TABLE "DmLog" ADD COLUMN "aiReviewReason" TEXT;
ALTER TABLE "DmLog" ADD COLUMN "aiGeneratedReply" TEXT;
