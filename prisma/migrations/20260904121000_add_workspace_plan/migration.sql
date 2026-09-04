CREATE TYPE "WorkspacePlan" AS ENUM ('FREE', 'PRO', 'AGENCY');

ALTER TABLE "Workspace"
ADD COLUMN "plan" "WorkspacePlan" NOT NULL DEFAULT 'FREE';
