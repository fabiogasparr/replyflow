/** PostgreSQL checks for branded, revocable shared reports. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Client } from "pg";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
config({ path: [path.join(projectRoot, ".env.local"), path.join(projectRoot, ".env")], quiet: true });

const targetMigration = "20260909103000_add_report_sharing_controls";
const schema = `replyflow_report_sharing_test_${randomBytes(8).toString("hex")}`;
const safeSchema = /^replyflow_report_sharing_test_[a-f0-9]{16}$/;

function databaseUrl() {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("O teste de compartilhamento aceita somente PostgreSQL local.");
  }
  return value;
}

async function migrationSql(name: string) {
  const sql = await readFile(path.join(projectRoot, "prisma/migrations", name, "migration.sql"), "utf8");
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
    assert.ok(targetIndex > 0, "Migration de compartilhamento não encontrada.");
    for (const name of migrations.slice(0, targetIndex)) {
      await client.query(await migrationSql(name));
    }

    await client.query(`
      INSERT INTO "User" (id, name, email, "createdAt", "updatedAt")
      VALUES ('user_legacy', 'Legado', 'legacy@example.test', NOW(), NOW());
      INSERT INTO "Workspace" (id, name, "ownerId", "createdAt", "updatedAt")
      VALUES ('workspace_legacy', 'Workspace legado', 'user_legacy', NOW(), NOW());
      INSERT INTO "InstagramAccount" (id, "workspaceId", "instagramId", username, "accessToken", "connectedAt", "updatedAt")
      VALUES ('account_legacy', 'workspace_legacy', 'instagram_legacy', 'legacy', 'token-falso', NOW(), NOW());
      INSERT INTO "Automation" (id, "workspaceId", "instagramAccountId", name, keywords, "dmMessage", "reportShareSlug", "reportShareEnabled", "createdAt", "updatedAt")
      VALUES ('automation_legacy', 'workspace_legacy', 'account_legacy', 'Campanha legada', ARRAY['LINK'], 'Mensagem', 'legacy_slug', true, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day');
    `);

    await client.query(await migrationSql(targetMigration));

    const legacy = await client.query<{
      reportShareEnabled: boolean;
      reportSharePeriodDays: number;
      reportSharePublishedAt: Date | null;
    }>(`SELECT "reportShareEnabled", "reportSharePeriodDays", "reportSharePublishedAt" FROM "Automation" WHERE id = 'automation_legacy'`);
    assert.equal(legacy.rows[0]?.reportShareEnabled, true);
    assert.equal(legacy.rows[0]?.reportSharePeriodDays, 30);
    assert.ok(legacy.rows[0]?.reportSharePublishedAt instanceof Date);

    await client.query(`
      INSERT INTO "Automation" (id, "workspaceId", "instagramAccountId", name, keywords, "dmMessage", "createdAt", "updatedAt")
      VALUES ('automation_new', 'workspace_legacy', 'account_legacy', 'Campanha nova', ARRAY['GUIA'], 'Mensagem', NOW(), NOW())
    `);
    const fresh = await client.query<{ enabled: boolean; days: number }>(
      `SELECT "reportShareEnabled" AS enabled, "reportSharePeriodDays" AS days FROM "Automation" WHERE id = 'automation_new'`
    );
    assert.deepEqual(fresh.rows[0], { enabled: false, days: 30 });

    const brand = await client.query<{ name: string | null; color: string }>(
      `SELECT "reportBrandName" AS name, "reportBrandColor" AS color FROM "Workspace" WHERE id = 'workspace_legacy'`
    );
    assert.deepEqual(brand.rows[0], { name: null, color: "#112620" });

    await assert.rejects(
      client.query(`UPDATE "Workspace" SET "reportBrandColor" = 'red' WHERE id = 'workspace_legacy'`),
      /Workspace_reportBrandColor_check/
    );
    await assert.rejects(
      client.query(`UPDATE "Automation" SET "reportSharePeriodDays" = 14 WHERE id = 'automation_new'`),
      /Automation_reportSharePeriodDays_check/
    );

    console.log(`Compartilhamento: defaults, backfill e constraints aprovados após ${targetIndex + 1} migrations reais.`);
  } finally {
    try {
      if (created) {
        assert.match(schema, safeSchema);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado de compartilhamento removido.");
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error("Falha nos testes SQL de compartilhamento:", error);
  process.exitCode = 1;
});
