-- AlterTable
ALTER TABLE "Automation" ADD COLUMN "audienceDmEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Automation" ADD COLUMN "followerDmMessage" TEXT;
ALTER TABLE "Automation" ADD COLUMN "nonFollowerDmMessage" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "followsAccount" BOOLEAN;
ALTER TABLE "Contact" ADD COLUMN "followedByAccount" BOOLEAN;
ALTER TABLE "Contact" ADD COLUMN "followStatusCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Contact_workspaceId_followsAccount_idx" ON "Contact"("workspaceId", "followsAccount");
