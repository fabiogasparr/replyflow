-- Privacy erasure replaces the external identity with a reserved deleted:
-- tombstone. Prevent that operational history from recreating a Contact.
CREATE OR REPLACE FUNCTION "sync_contact_from_dm_log"() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
    observed_username TEXT := NULLIF(BTRIM(NEW."commenterName"), '');
BEGIN
    -- Missing and privacy-erased identities cannot form a usable contact.
    IF BTRIM(NEW."commenterId") = '' OR NEW."commenterId" LIKE 'deleted:%' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."commenterName" IS NOT DISTINCT FROM OLD."commenterName" THEN
            RETURN NEW;
        END IF;
    END IF;

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
    RETURN NEW;
END;
$$;

-- Rollback: deploy application code without privacy erasure first, then publish
-- a compensating migration that restores the previous function definition.
