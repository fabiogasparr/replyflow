/** PostgreSQL check for the global support triage index. */
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

const targetMigration = "20260909123000_add_platform_support_index";
const schema = `replyflow_support_test_${randomBytes(8).toString("hex")}`;
const safeSchema = /^replyflow_support_test_[a-f0-9]{16}$/;
const expectedIndex = "DmLog_status_updatedAt_id_idx";

function databaseUrl() {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("O teste de suporte aceita somente PostgreSQL local.");
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
    assert.ok(targetIndex > 0, "Migration da central de suporte não encontrada.");
    for (const name of migrations.slice(0, targetIndex + 1)) {
      await client.query(await migrationSql(name));
    }

    const indexes = await client.query<{ indexdef: string }>(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname = $1`,
      [expectedIndex]
    );
    assert.equal(indexes.rowCount, 1);
    assert.match(indexes.rows[0]?.indexdef ?? "", /USING btree/i);
    assert.match(
      indexes.rows[0]?.indexdef ?? "",
      /\((?:"status"|status), "updatedAt", (?:"id"|id)\)/
    );

    console.log(
      `Suporte: índice global aprovado após ${targetIndex + 1} migrations reais.`
    );
  } finally {
    try {
      if (created) {
        assert.match(schema, safeSchema);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado de suporte removido.");
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error("Falha nos testes SQL da central de suporte:", error);
  process.exitCode = 1;
});
