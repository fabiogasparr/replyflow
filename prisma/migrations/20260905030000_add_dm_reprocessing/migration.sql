-- Persist the immutable source data required to safely rebuild a failed queue
-- job. A delivery attempt is an explicit safety boundary: once set, operators
-- cannot manually replay the row because Meta does not expose an idempotency
-- key for private replies.
CREATE TYPE "DmTriggerType" AS ENUM ('COMMENT', 'MESSAGE', 'POSTBACK');

ALTER TABLE "DmLog"
  ADD COLUMN "triggerType" "DmTriggerType" NOT NULL DEFAULT 'COMMENT',
  ADD COLUMN "sourceEventId" TEXT,
  ADD COLUMN "sourceMediaId" TEXT,
  ADD COLUMN "originalMediaId" TEXT,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "deliveryAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "manualRetryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastManualRetryAt" TIMESTAMP(3);

-- Existing inbound-message and button-tap records are recognizable by the
-- stable prefixes already used by the worker.
UPDATE "DmLog"
SET
  "triggerType" = 'MESSAGE',
  "sourceEventId" = SUBSTRING("commentId" FROM 4)
WHERE "commentId" LIKE 'dm:%';

UPDATE "DmLog"
SET
  "triggerType" = 'POSTBACK',
  "sourceEventId" = SUBSTRING("commentId" FROM 8)
WHERE "commentId" LIKE 'reveal:%';

UPDATE "DmLog"
SET
  "sourceEventId" = "commentId"
WHERE "triggerType" = 'COMMENT';

-- A post-bound campaign supplies a useful fallback for historical rows. Any-
-- post campaigns intentionally remain without sourceMediaId and therefore are
-- not replayable unless a new worker pass records the original media id.
UPDATE "DmLog" AS log
SET "sourceMediaId" = automation."postId"
FROM "Automation" AS automation
WHERE
  log."automationId" = automation."id"
  AND log."triggerType" = 'COMMENT'
  AND automation."matchAnyPost" = FALSE;

-- Historical failures are treated as potentially attempted unless the stored
-- error proves the worker stopped before calling Meta.
UPDATE "DmLog"
SET "deliveryAttemptedAt" = "updatedAt"
WHERE
  "status" = 'FAILED'
  AND "errorMessage" NOT IN (
    'No Instagram access token available',
    'Failed to decrypt Instagram access token'
  );

CREATE INDEX "DmLog_workspaceId_status_lastManualRetryAt_idx"
  ON "DmLog"("workspaceId", "status", "lastManualRetryAt");
