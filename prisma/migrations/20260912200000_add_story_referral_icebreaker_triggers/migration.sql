-- AlterEnum
ALTER TYPE "DmTriggerType" ADD VALUE 'STORY';
ALTER TYPE "DmTriggerType" ADD VALUE 'REFERRAL';
ALTER TYPE "DmTriggerType" ADD VALUE 'ICE_BREAKER';

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN "storyTriggerEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Automation" ADD COLUMN "referralTriggerEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Automation" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "Automation" ADD COLUMN "iceBreakerQuestion" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Automation_instagramAccountId_referralCode_key" ON "Automation"("instagramAccountId", "referralCode");
