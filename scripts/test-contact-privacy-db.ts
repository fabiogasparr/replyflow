/**
 * Contact privacy trigger checks. Run with `npm run test:contact-privacy-db`.
 * Only localhost PostgreSQL is accepted. A disposable schema receives every
 * real migration and is always removed; application data is never touched.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Client } from "pg";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
config({ path: [path.join(projectRoot, ".env.local"), path.join(projectRoot, ".env")], quiet: true });

const targetMigration = "20260911100000_protect_anonymized_contacts";
const schema = `replyflow_privacy_test_${randomBytes(8).toString("hex")}`;
const allowedSchemaPattern = /^replyflow_privacy_test_[a-f0-9]{16}$/;

function connectionString() {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("O teste de privacidade aceita somente PostgreSQL em localhost.");
  }
  return value;
}

async function migrationSql(name: string) {
  const sql = await readFile(path.join(projectRoot, "prisma/migrations", name, "migration.sql"), "utf8");
  const isolatedSql = sql.replace(/^CREATE SCHEMA IF NOT EXISTS "public";\s*$/m, "");
  assert.doesNotMatch(isolatedSql, /\bpublic\s*\.|"public"\s*\./i);
  assert.doesNotMatch(isolatedSql, /\bCREATE\s+SCHEMA\b/i);
  return isolatedSql;
}

async function main() {
  const client = new Client({ connectionString: connectionString() });
  let schemaCreated = false;
  await client.connect();
  try {
    assert.match(schema, allowedSchemaPattern);
    await client.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await client.query(`SET search_path TO "${schema}", pg_catalog`);
    await client.query("SET statement_timeout = '30s'");
    await client.query("SET lock_timeout = '10s'");

    const migrations = (await readdir(path.join(projectRoot, "prisma/migrations")))
      .filter((name) => /^\d{14}_/.test(name)).sort();
    assert.ok(migrations.includes(targetMigration), "A migration de privacidade não foi encontrada.");
    for (const name of migrations) await client.query(await migrationSql(name));

    await client.query(`
      INSERT INTO "User" ("id", "email", "updatedAt")
        VALUES ('privacy_owner', 'privacy-test@example.invalid', CURRENT_TIMESTAMP);
      INSERT INTO "Workspace" ("id", "name", "ownerId", "updatedAt")
        VALUES ('privacy_workspace', 'Privacidade', 'privacy_owner', CURRENT_TIMESTAMP);
      INSERT INTO "InstagramAccount" ("id", "workspaceId", "instagramId", "username", "accessToken", "updatedAt")
        VALUES ('privacy_account', 'privacy_workspace', 'external_privacy', 'conta_privada', 'test-placeholder', CURRENT_TIMESTAMP);
      INSERT INTO "Automation" ("id", "workspaceId", "instagramAccountId", "name", "keywords", "dmMessage", "updatedAt")
        VALUES ('privacy_automation', 'privacy_workspace', 'privacy_account', 'Automação', ARRAY['teste'], 'Olá', CURRENT_TIMESTAMP);
    `);

    await client.query(`INSERT INTO "DmLog" (
      "id", "workspaceId", "instagramAccountId", "automationId", "commenterId",
      "commenterName", "commentId", "commentText", "updatedAt"
    ) VALUES (
      'normal_log', 'privacy_workspace', 'privacy_account', 'privacy_automation',
      'normal_person', 'Maria', 'normal_comment', 'Quero saber mais', CURRENT_TIMESTAMP
    )`);
    assert.equal((await client.query(`SELECT COUNT(*)::INT AS count FROM "Contact"
      WHERE "instagramScopedId" = 'normal_person'`)).rows[0].count, 1);

    await client.query(`INSERT INTO "DmLog" (
      "id", "workspaceId", "instagramAccountId", "automationId", "commenterId",
      "commenterName", "commentId", "commentText", "updatedAt"
    ) VALUES (
      'deleted_log', 'privacy_workspace', 'privacy_account', 'privacy_automation',
      'deleted:0123456789abcdef', NULL, 'deleted_comment', '[conteúdo removido]', CURRENT_TIMESTAMP
    )`);
    assert.equal((await client.query(`SELECT COUNT(*)::INT AS count FROM "Contact"
      WHERE "instagramScopedId" LIKE 'deleted:%'`)).rows[0].count, 0);

    await client.query(`
      INSERT INTO "ProcessedComment" ("id", "instagramAccountId", "commentId", "source") VALUES
        ('processed_target', 'privacy_account', 'normal_comment', 'WEBHOOK'),
        ('processed_other', 'privacy_account', 'other_comment', 'WEBHOOK');
      INSERT INTO "WebhookEvent" ("id", "workspaceId", "payload") VALUES
        ('webhook_target', 'privacy_workspace', '{"entry":[{"sender":{"id":"normal_person"}}]}'::jsonb),
        ('webhook_similar', 'privacy_workspace', '{"entry":[{"sender":{"id":"normal_person_2"}}]}'::jsonb),
        ('webhook_other_workspace', NULL, '{"entry":[{"sender":{"id":"normal_person"}}]}'::jsonb);
    `);

    const tombstone = "deleted:fedcba9876543210";
    await client.query("BEGIN");
    const webhooks = await client.query(`DELETE FROM "WebhookEvent" AS event
      WHERE event."workspaceId" = 'privacy_workspace'
        AND jsonb_path_exists(
          event."payload"::jsonb,
          '$.** ? (@ == $identity)',
          jsonb_build_object('identity', to_jsonb('normal_person'::text))
        )`);
    assert.equal(webhooks.rowCount, 1);

    const logs = await client.query(`UPDATE "DmLog" AS log SET
      "commenterId" = $1, "commenterName" = NULL,
      "commentText" = '[conteúdo removido por solicitação de privacidade]',
      "matchedKeyword" = NULL, "errorMessage" = NULL,
      "sourceEventId" = NULL, "sourceMediaId" = NULL,
      "originalMediaId" = NULL, "source" = NULL,
      "publicReplyError" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      FROM "Automation" AS automation, "InstagramAccount" AS account
      WHERE log."workspaceId" = 'privacy_workspace'
        AND log."instagramAccountId" = 'privacy_account'
        AND log."commenterId" = 'normal_person'
        AND automation."id" = log."automationId"
        AND automation."workspaceId" = 'privacy_workspace'
        AND automation."instagramAccountId" = 'privacy_account'
        AND account."id" = log."instagramAccountId"
        AND account."workspaceId" = 'privacy_workspace'`, [tombstone]);
    assert.equal(logs.rowCount, 1);
    await client.query("COMMIT");

    assert.equal((await client.query(`SELECT COUNT(*)::INT AS count FROM "ProcessedComment"
      WHERE "commentId" IN ('normal_comment', 'other_comment')`)).rows[0].count, 2);
    assert.equal((await client.query(`SELECT COUNT(*)::INT AS count FROM "WebhookEvent"
      WHERE "id" IN ('webhook_similar', 'webhook_other_workspace')`)).rows[0].count, 2);
    assert.equal((await client.query(`SELECT COUNT(*)::INT AS count FROM "DmLog"
      WHERE "id" = 'normal_log' AND "commenterId" = $1
        AND "commenterName" IS NULL AND "sourceEventId" IS NULL
        AND "commentId" = 'normal_comment'`, [tombstone])).rows[0].count, 1);
    await assert.rejects(
      client.query(`INSERT INTO "DmLog" (
        "id", "workspaceId", "instagramAccountId", "automationId", "commenterId",
        "commenterName", "commentId", "commentText", "updatedAt"
      ) VALUES (
        'replayed_log', 'privacy_workspace', 'privacy_account', 'privacy_automation',
        'normal_person', 'Maria', 'normal_comment', 'Quero saber mais', CURRENT_TIMESTAMP
      )`),
      (error: unknown) => typeof error === "object" && error !== null
        && "code" in error && error.code === "23505",
    );
    assert.equal((await client.query(`SELECT COUNT(*)::INT AS count FROM "Contact"
      WHERE "instagramScopedId" LIKE 'deleted:%'`)).rows[0].count, 0);
    assert.equal((await client.query(`SELECT COUNT(*)::INT AS count FROM "Contact"
      WHERE "instagramScopedId" = 'normal_person'`)).rows[0].count, 1,
    "O gatilho não remove o perfil; a transação de privacidade controla a cascata separadamente.");

    console.log(`✓ Identidades anonimizadas não recriam contatos após ${migrations.length} migrations reais.`);
  } finally {
    try {
      await client.query("ROLLBACK");
      if (schemaCreated) {
        assert.match(schema, allowedSchemaPattern);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado de privacidade removido.");
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
