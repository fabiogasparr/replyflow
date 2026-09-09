/** PostgreSQL checks for tenant-scoped performance report indexes. */
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

const targetMigration = "20260909093000_add_performance_report_indexes";
const schema = `replyflow_reporting_test_${randomBytes(8).toString("hex")}`;
const safeSchema = /^replyflow_reporting_test_[a-f0-9]{16}$/;
const expectedIndexes = [
  "DmLog_workspaceId_createdAt_idx",
  "DmLog_workspaceId_instagramAccountId_createdAt_idx",
  "DmLog_workspaceId_automationId_createdAt_idx",
  "LinkClick_workspaceId_instagramAccountId_createdAt_idx",
  "LinkClick_workspaceId_automationId_createdAt_idx",
];

function databaseUrl() {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("O teste de relatórios aceita somente PostgreSQL local.");
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
    await client.query("SET statement_timeout = '30s'");

    const migrations = (await readdir(path.join(projectRoot, "prisma/migrations")))
      .filter((name) => /^\d{14}_/.test(name))
      .sort();
    const targetIndex = migrations.indexOf(targetMigration);
    assert.ok(targetIndex > 0, "Migration dos índices de relatórios não encontrada.");
    for (const name of migrations.slice(0, targetIndex + 1)) {
      await client.query(await migrationSql(name));
    }

    const indexes = await client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [expectedIndexes]
    );
    assert.deepEqual(
      indexes.rows.map((index) => index.indexname).sort(),
      [...expectedIndexes].sort()
    );
    for (const index of indexes.rows) {
      assert.match(index.indexdef, /USING btree/i);
      assert.match(index.indexdef, /"workspaceId"/);
      assert.match(index.indexdef, /"createdAt"/);
    }

    console.log(
      `Relatórios: ${expectedIndexes.length} índices aprovados após ${targetIndex + 1} migrations reais.`
    );
  } finally {
    try {
      if (created) {
        assert.match(schema, safeSchema);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado de relatórios removido.");
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error("Falha nos testes SQL de relatórios:", error);
  process.exitCode = 1;
});
