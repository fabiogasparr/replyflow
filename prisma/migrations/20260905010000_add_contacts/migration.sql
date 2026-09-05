-- Contact is a projection of automation logs, not the complete Instagram inbox.
-- Keep the trigger and historical backfill atomic so concurrent workers cannot
-- create a log between the backfill snapshot and trigger installation.
BEGIN;

CREATE UNIQUE INDEX "InstagramAccount_id_workspaceId_key"
    ON "InstagramAccount"("id", "workspaceId");

CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "instagramScopedId" TEXT NOT NULL,
    "username" TEXT,
    "usernameObservedAt" TIMESTAMP(3),
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Contact_workspace_account_scoped_key"
    ON "Contact"("workspaceId", "instagramAccountId", "instagramScopedId");
CREATE INDEX "Contact_workspaceId_lastSeenAt_idx"
    ON "Contact"("workspaceId", "lastSeenAt");
CREATE INDEX "Contact_workspaceId_instagramAccountId_lastSeenAt_idx"
    ON "Contact"("workspaceId", "instagramAccountId", "lastSeenAt");

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_instagramAccountId_workspaceId_fkey"
    FOREIGN KEY ("instagramAccountId", "workspaceId")
    REFERENCES "InstagramAccount"("id", "workspaceId")
    ON DELETE CASCADE ON UPDATE CASCADE;

LOCK TABLE "DmLog" IN SHARE ROW EXCLUSIVE MODE;

-- Refuse to project inconsistent legacy data into a different workspace.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "DmLog" AS log
        JOIN "InstagramAccount" AS account ON account."id" = log."instagramAccountId"
        WHERE account."workspaceId" <> log."workspaceId"
    ) THEN
        RAISE EXCEPTION 'Contact migration requires DmLog and InstagramAccount workspace ownership to agree';
    END IF;
END;
$$;

CREATE INDEX "DmLog_contact_createdAt_idx"
    ON "DmLog"("workspaceId", "instagramAccountId", "commenterId", "createdAt");

CREATE FUNCTION "sync_contact_from_dm_log"() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
    observed_username TEXT := NULLIF(BTRIM(NEW."commenterName"), '');
BEGIN
    -- Missing identities cannot form a usable contact. Names are optional.
    IF BTRIM(NEW."commenterId") = '' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."commenterName" IS NOT DISTINCT FROM OLD."commenterName" THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Prisma's cuid()/@updatedAt are client-side defaults. SQL explicitly
    -- supplies an opaque UUID and timestamps; both ID formats are valid TEXT.
    INSERT INTO "Contact" (
        "id", "workspaceId", "instagramAccountId", "instagramScopedId",
        "username", "usernameObservedAt", "firstSeenAt", "lastSeenAt", "updatedAt"
    ) VALUES (
        gen_random_uuid()::TEXT, NEW."workspaceId", NEW."instagramAccountId", NEW."commenterId",
        observed_username,
        CASE WHEN observed_username IS NOT NULL THEN NEW."createdAt" END,
        NEW."createdAt", NEW."createdAt", CURRENT_TIMESTAMP
    )
    ON CONFLICT ("workspaceId", "instagramAccountId", "instagramScopedId")
    DO UPDATE SET
        "firstSeenAt" = LEAST("Contact"."firstSeenAt", EXCLUDED."firstSeenAt"),
        "lastSeenAt" = GREATEST("Contact"."lastSeenAt", EXCLUDED."lastSeenAt"),
        "username" = CASE
            WHEN EXCLUDED."usernameObservedAt" IS NOT NULL AND (
                "Contact"."usernameObservedAt" IS NULL
                OR EXCLUDED."usernameObservedAt" >= "Contact"."usernameObservedAt"
            ) THEN EXCLUDED."username"
            ELSE "Contact"."username"
        END,
        "usernameObservedAt" = CASE
            WHEN EXCLUDED."usernameObservedAt" IS NOT NULL AND (
                "Contact"."usernameObservedAt" IS NULL
                OR EXCLUDED."usernameObservedAt" >= "Contact"."usernameObservedAt"
            ) THEN EXCLUDED."usernameObservedAt"
            ELSE "Contact"."usernameObservedAt"
        END,
        "updatedAt" = CURRENT_TIMESTAMP;
    -- tags, notes and version are deliberately never updated by ingestion.
    RETURN NEW;
END;
$$;

CREATE TRIGGER "DmLog_sync_contact"
AFTER INSERT OR UPDATE OF "commenterName" ON "DmLog"
FOR EACH ROW EXECUTE FUNCTION "sync_contact_from_dm_log"();

-- Historical interaction times come from createdAt, never a retry's updatedAt.
-- The latest nonblank name may predate the latest (anonymous) interaction.
INSERT INTO "Contact" (
    "id", "workspaceId", "instagramAccountId", "instagramScopedId",
    "username", "usernameObservedAt", "firstSeenAt", "lastSeenAt", "updatedAt"
)
SELECT
    gen_random_uuid()::TEXT,
    "workspaceId", "instagramAccountId", "commenterId",
    (ARRAY_AGG(NULLIF(BTRIM("commenterName"), '') ORDER BY "createdAt" DESC, "id" DESC)
        FILTER (WHERE NULLIF(BTRIM("commenterName"), '') IS NOT NULL))[1],
    MAX("createdAt") FILTER (WHERE NULLIF(BTRIM("commenterName"), '') IS NOT NULL),
    MIN("createdAt"), MAX("createdAt"), CURRENT_TIMESTAMP
FROM "DmLog"
WHERE BTRIM("commenterId") <> ''
GROUP BY "workspaceId", "instagramAccountId", "commenterId";

-- Identity fields and createdAt on DmLog remain immutable application inputs.
-- Rollback: deploy compatible app code, drop the trigger and function in a new
-- migration, and preserve Contact (especially manual notes/tags/version).
COMMIT;
