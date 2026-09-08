/** PostgreSQL checks for the deny-by-default global administration role. */
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

const targetMigration = "20260908200000_add_platform_role";
const schema = `replyflow_admin_test_${randomBytes(8).toString("hex")}`;
const safeSchema = /^replyflow_admin_test_[a-f0-9]{16}$/;

function databaseUrl() {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("O teste de administração aceita somente PostgreSQL local.");
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
    assert.ok(targetIndex > 0, "Migration do papel global não encontrada.");
    for (const name of migrations.slice(0, targetIndex)) {
      await client.query(await migrationSql(name));
    }

    await client.query(`
      INSERT INTO "User" ("id", "email", "emailVerified", "updatedAt")
      VALUES (
        'existing_user', 'existing@example.invalid', CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `);
    await client.query(await migrationSql(targetMigration));

    const migratedRole = await client.query(
      `SELECT "platformRole" FROM "User" WHERE "id" = 'existing_user'`
    );
    assert.equal(migratedRole.rows[0].platformRole, "USER");

    await client.query(`
      INSERT INTO "User" ("id", "email", "updatedAt")
      VALUES ('new_user', 'new@example.invalid', CURRENT_TIMESTAMP)
    `);
    const defaultRole = await client.query(
      `SELECT "platformRole" FROM "User" WHERE "id" = 'new_user'`
    );
    assert.equal(defaultRole.rows[0].platformRole, "USER");

    await client.query(
      `UPDATE "User" SET "platformRole" = 'ADMIN' WHERE "id" = 'existing_user'`
    );
    const adminCount = await client.query(
      `SELECT COUNT(*)::int AS count FROM "User" WHERE "platformRole" = 'ADMIN'`
    );
    assert.equal(adminCount.rows[0].count, 1);

    const index = await client.query(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname = 'User_platformRole_idx'`
    );
    assert.match(index.rows[0]?.indexdef ?? "", /platformRole/);

    await client.query("BEGIN");
    try {
      await client.query(
        `UPDATE "User" SET "platformRole" = 'OWNER' WHERE "id" = 'new_user'`
      );
      assert.fail("O PostgreSQL deveria rejeitar um papel global desconhecido.");
    } catch (error) {
      assert.equal((error as { code?: string }).code, "22P02");
    } finally {
      await client.query("ROLLBACK");
    }

    console.log(
      `Administração: backfill seguro, promoção, enum e índice aprovados após ${targetIndex + 1} migrations reais.`
    );
  } finally {
    try {
      if (created) {
        assert.match(schema, safeSchema);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado de administração removido.");
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error("Falha nos testes SQL de administração:", error);
  process.exitCode = 1;
});
