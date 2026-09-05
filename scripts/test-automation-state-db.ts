/**
 * PostgreSQL checks for the automation operational-state projection.
 * Migrations run in a disposable localhost schema and never touch app data.
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

const targetMigration = "20260905040000_add_automation_operational_state";
const schema = `replyflow_automation_state_test_${randomBytes(8).toString("hex")}`;
const safeSchema = /^replyflow_automation_state_test_[a-f0-9]{16}$/;

function databaseUrl() {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("O teste de estados aceita somente PostgreSQL em localhost.");
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
    assert.ok(targetIndex > 0, "Migration de estados operacionais não encontrada.");
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
        "id", "workspaceId", "instagramAccountId", "name", "postId",
        "keywords", "dmMessage", "updatedAt"
      ) VALUES (
        'automation_1', 'workspace_1', 'account_1', 'Campanha', 'media_1',
        ARRAY['quero'], 'Olá', CURRENT_TIMESTAMP
      );
    `);

    await client.query(await migrationSql(targetMigration));
    const initial = (
      await client.query(
        `SELECT "lastRunAt", "lastSuccessAt", "lastErrorAt", "lastErrorKind",
          "lastErrorMessage", "consecutiveFailures"
        FROM "Automation" WHERE "id" = 'automation_1'`
      )
    ).rows[0];
    assert.deepEqual(initial, {
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorKind: null,
      lastErrorMessage: null,
      consecutiveFailures: 0,
    });

    await client.query(`
      UPDATE "Automation" SET
        "lastRunAt" = '2026-09-05T12:00:00Z',
        "lastErrorAt" = '2026-09-05T12:00:00Z',
        "lastErrorKind" = 'AUTHENTICATION',
        "lastErrorMessage" = 'token expired',
        "consecutiveFailures" = "consecutiveFailures" + 1
      WHERE "id" = 'automation_1'
    `);
    const updated = (
      await client.query(
        `SELECT "lastErrorKind", "lastErrorMessage", "consecutiveFailures"
        FROM "Automation" WHERE "id" = 'automation_1'`
      )
    ).rows[0];
    assert.deepEqual(updated, {
      lastErrorKind: "AUTHENTICATION",
      lastErrorMessage: "token expired",
      consecutiveFailures: 1,
    });

    const index = await client.query(
      `SELECT indexname FROM pg_indexes
      WHERE schemaname = $1 AND indexname = 'Automation_workspaceId_lastErrorAt_idx'`,
      [schema]
    );
    assert.equal(index.rowCount, 1);
    console.log(
      `Estados de automação: defaults, projeção e índice aprovados após ${targetIndex + 1} migrations reais.`
    );
  } finally {
    try {
      await client.query("ROLLBACK");
      if (created) {
        assert.match(schema, safeSchema);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado de estados de automação removido.");
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error("Falha nos testes SQL de estados de automação:", error);
  process.exitCode = 1;
});
