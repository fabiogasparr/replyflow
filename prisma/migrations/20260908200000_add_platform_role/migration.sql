CREATE TYPE "PlatformRole" AS ENUM ('USER', 'ADMIN');

ALTER TABLE "User"
  ADD COLUMN "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER';

CREATE INDEX "User_platformRole_idx" ON "User"("platformRole");
