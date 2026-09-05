/**
 * Database checks for safe DM reprocessing metadata and historical backfill.
 * Every migration runs in a disposable schema on localhost PostgreSQL.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Client } from "pg";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
config({
  path: [path.join(projectRoot, ".env.local"), path.join(projectRoot, ".env")],
  quiet: true,
});

const targetMigration = "20260905030000_add_dm_reprocessing";
const schema = `replyflow_dm_retry_test_${randomBytes(8).toString("hex")}`;
const safeSchema = /^replyflow_dm_retry_test_[a-f0-9]{16}$/;

function databaseUrl() {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("O teste de reprocessamento aceita somente PostgreSQL em localhost.");
  }
  return value;
}

async function migrationSql(name: string) {
  const sql = await readFile(
    path.join(projectRoot, "prisma/migrations", name, "migration.sql"),
    "utf8"
  );
  const isolated = sql.replace(/^CREATE SCHEMA IF NOT EXISTS "public";\s*$/m, "");
  assert.doesNotMatch(isolated, /\bpublic\s*\.|"public"\s*\./i);
  assert.doesNotMatch(isolated, /\bCREATE\s+SCHEMA\b/i);
  return isolated;
}

async function main() {
  const client = new Client({ connectionString: databaseUrl() });
  let created = false;
  await client.connect();
  try {
    assert.match(schema, safeSchema);
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}", pg_catalog`);
    await client.query("SET TIME ZONE 'UTC'");
    await client.query("SET statement_timeout = '30s'");

    const migrations = (await readdir(path.join(projectRoot, "prisma/migrations")))
      .filter((name) => /^\d{14}_/.test(name))
      .sort();
    const targetIndex = migrations.indexOf(targetMigration);
    assert.ok(targetIndex > 0, "Migration de reprocessamento não encontrada.");
    for (const name of migrations.slice(0, targetIndex)) {
      await client.query(await migrationSql(name));
    }

    await client.query(`
      INSERT INTO "User" ("id", "email", "updatedAt")
        VALUES ('owner_1', 'owner@example.invalid', CURRENT_TIMESTAMP);
      INSERT INTO "Workspace" ("id", "name", "ownerId", "updatedAt")
        VALUES ('workspace_1', 'Empresa', 'owner_1', CURRENT_TIMESTAMP);
      INSERT INTO "InstagramAccount" (
        "id", "workspaceId", "instagramId", "username", "accessToken", "updatedAt"
      ) VALUES ('account_1', 'workspace_1', 'business_1', 'empresa', 'placeholder', CURRENT_TIMESTAMP);
      INSERT INTO "Automation" (
        "id", "workspaceId", "instagramAccountId", "name", "postId", "matchAnyPost",
        "keywords", "dmMessage", "updatedAt"
      ) VALUES
        ('automation_post', 'workspace_1', 'account_1', 'Publicação', 'media_1', FALSE,
          ARRAY['quero'], 'Olá', CURRENT_TIMESTAMP),
        ('automation_any', 'workspace_1', 'account_1', 'Qualquer publicação', NULL, TRUE,
          ARRAY['quero'], 'Olá', CURRENT_TIMESTAMP);
      INSERT INTO "DmLog" (
        "id", "workspaceId", "automationId", "instagramAccountId", "commenterId",
        "commentText", "commentId", "status", "errorMessage", "createdAt", "updatedAt"
      ) VALUES
        ('safe_comment', 'workspace_1', 'automation_post', 'account_1', 'person_1',
          'quero', 'comment_1', 'FAILED', 'No Instagram access token available',
          '2026-09-05T10:00:00Z', '2026-09-05T10:01:00Z'),
        ('ambiguous_comment', 'workspace_1', 'automation_any', 'account_1', 'person_2',
          'quero', 'comment_2', 'FAILED', 'Network response lost',
          '2026-09-05T11:00:00Z', '2026-09-05T11:01:00Z'),
        ('message_limit', 'workspace_1', 'automation_post', 'account_1', 'person_3',
          'quero', 'dm:message_1', 'SKIPPED_PLAN_LIMIT', 'Monthly DM limit reached (100)',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('button_tap', 'workspace_1', 'automation_post', 'account_1', 'person_4',
          '(button tap)', 'reveal:person_4', 'FAILED', 'Failed to decrypt Instagram access token',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    `);

    await client.query(await migrationSql(targetMigration));

    const safe = (
      await client.query(
        `SELECT "triggerType", "sourceEventId", "sourceMediaId", "deliveryAttemptedAt",
          "manualRetryCount", "lastManualRetryAt"
        FROM "DmLog" WHERE "id" = 'safe_comment'`
      )
    ).rows[0];
    assert.equal(safe.triggerType, "COMMENT");
    assert.equal(safe.sourceEventId, "comment_1");
    assert.equal(safe.sourceMediaId, "media_1");
    assert.equal(safe.deliveryAttemptedAt, null);
    assert.equal(safe.manualRetryCount, 0);
    assert.equal(safe.lastManualRetryAt, null);

    const ambiguous = (
      await client.query(
        `SELECT "triggerType", "sourceMediaId", "deliveryAttemptedAt"
        FROM "DmLog" WHERE "id" = 'ambiguous_comment'`
      )
    ).rows[0];
    assert.equal(ambiguous.triggerType, "COMMENT");
    assert.equal(ambiguous.sourceMediaId, null);
    assert.ok(ambiguous.deliveryAttemptedAt instanceof Date);
    console.log("✓ Falhas históricas ambíguas ficam bloqueadas e registros seguros preservam a origem");

    const typed = await client.query(
      `SELECT "id", "triggerType", "sourceEventId" FROM "DmLog"
      WHERE "id" IN ('message_limit', 'button_tap') ORDER BY "id"`
    );
    assert.deepEqual(typed.rows, [
      { id: "button_tap", triggerType: "POSTBACK", sourceEventId: "person_4" },
      { id: "message_limit", triggerType: "MESSAGE", sourceEventId: "message_1" },
    ]);

    const index = await client.query(
      `SELECT indexname FROM pg_indexes
      WHERE schemaname = $1 AND indexname = 'DmLog_workspaceId_status_lastManualRetryAt_idx'`,
      [schema]
    );
    assert.equal(index.rowCount, 1);
    console.log(`Reprocessamento: backfill e índice aprovados após ${targetIndex + 1} migrations reais.`);
  } finally {
    try {
      await client.query("ROLLBACK");
      if (created) {
        assert.match(schema, safeSchema);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado de reprocessamento removido.");
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error("Falha nos testes SQL de reprocessamento:", error);
  process.exitCode = 1;
});
