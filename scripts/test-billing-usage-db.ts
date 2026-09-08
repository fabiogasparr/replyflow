/**
 * Concurrent DM metering checks against a disposable PostgreSQL schema.
 * No application workspace, queue or external provider is touched.
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

const schema = `replyflow_usage_test_${randomBytes(8).toString("hex")}`;
const safeSchema = /^replyflow_usage_test_[a-f0-9]{16}$/;

function databaseUrl() {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("O teste de uso aceita somente PostgreSQL em localhost.");
  }
  return value;
}

function scopedDatabaseUrl(value: string) {
  const url = new URL(value);
  url.searchParams.set("options", `-c search_path=${schema},pg_catalog`);
  return url.toString();
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
  const baseUrl = databaseUrl();
  const client = new Client({ connectionString: baseUrl });
  let created = false;
  let disconnectPrisma: (() => Promise<void>) | undefined;

  await client.connect();
  try {
    assert.match(schema, safeSchema);
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}", pg_catalog`);
    await client.query("SET TIME ZONE 'America/Sao_Paulo'");
    await client.query("SET statement_timeout = '30s'");

    const migrations = (await readdir(path.join(projectRoot, "prisma/migrations")))
      .filter((name) => /^\d{14}_/.test(name))
      .sort();
    for (const name of migrations) {
      await client.query(await migrationSql(name));
    }

    await client.query(`
      INSERT INTO "User" ("id", "email", "updatedAt")
        VALUES ('usage_owner', 'usage@example.invalid', CURRENT_TIMESTAMP);
      INSERT INTO "Workspace" (
        "id", "name", "ownerId", "plan", "usagePeriodStart",
        "dmsSentThisPeriod", "updatedAt"
      ) VALUES (
        'usage_workspace', 'Teste de medição', 'usage_owner', 'FREE',
        date_trunc('month', CURRENT_TIMESTAMP), 0, CURRENT_TIMESTAMP
      );
      UPDATE "Plan" SET "monthlyDmLimit" = 2 WHERE "code" = 'FREE';
      INSERT INTO "Subscription" (
        "id", "workspaceId", "planCode", "provider", "status",
        "currentPeriodStart", "updatedAt"
      ) VALUES (
        'usage_subscription', 'usage_workspace', 'FREE', 'MANUAL', 'ACTIVE',
        date_trunc('month', CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
      );
    `);

    const isolatedDatabaseUrl = scopedDatabaseUrl(baseUrl);
    const scopeProbe = new Client({ connectionString: isolatedDatabaseUrl });
    await scopeProbe.connect();
    try {
      const activeSchema = await scopeProbe.query(
        `SELECT current_schema() AS schema,
          (SELECT COUNT(*)::int FROM "Workspace") AS workspaces`
      );
      assert.deepEqual(activeSchema.rows[0], { schema, workspaces: 1 });
    } finally {
      await scopeProbe.end();
    }

    process.env.DATABASE_URL = isolatedDatabaseUrl;
    process.env.REPLYFLOW_DATABASE_SCHEMA = schema;
    const usage = await import("../lib/billing/usage");
    const database = await import("../lib/db/client");
    const prisma = database.getPrisma();
    disconnectPrisma = async () => prisma.$disconnect();
    const prismaSchema = await prisma.$queryRaw<Array<{ schema: string }>>`
      SELECT current_schema() AS schema
    `;
    assert.equal(prismaSchema[0]?.schema, schema);

    const reservations = await Promise.all([
      usage.reserveWorkspaceDMSend("usage_workspace"),
      usage.reserveWorkspaceDMSend("usage_workspace"),
      usage.reserveWorkspaceDMSend("usage_workspace"),
    ]);
    assert.equal(
      reservations.filter((result) => result.allowed).length,
      2,
      JSON.stringify(reservations)
    );
    assert.equal(
      reservations.filter((result) => !result.allowed).length,
      1,
      JSON.stringify(reservations)
    );
    assert.ok(reservations.every((result) => result.limit === 2));
    assert.deepEqual(await usage.canSendDMForWorkspace("usage_workspace"), {
      allowed: false,
      remaining: 0,
      limit: 2,
    });

    const counters = (
      await client.query(`
        SELECT
          (SELECT "quantity" FROM "UsageRecord"
           WHERE "workspaceId" = 'usage_workspace') AS usage,
          (SELECT "dmsSentThisPeriod" FROM "Workspace"
           WHERE "id" = 'usage_workspace') AS workspace
      `)
    ).rows[0];
    assert.deepEqual(counters, { usage: 2, workspace: 2 });

    const reservedPeriod = reservations.find((result) => result.allowed)?.periodStart;
    assert.ok(reservedPeriod);
    await usage.releaseWorkspaceDMReservation("usage_workspace", reservedPeriod);

    const releasedCounters = (
      await client.query(`
        SELECT
          (SELECT "quantity" FROM "UsageRecord"
           WHERE "workspaceId" = 'usage_workspace') AS usage,
          (SELECT "dmsSentThisPeriod" FROM "Workspace"
           WHERE "id" = 'usage_workspace') AS workspace
      `)
    ).rows[0];
    assert.deepEqual(releasedCounters, { usage: 1, workspace: 1 });

    console.log(
      `Uso: limite do plano, concorrência, espelho e compensação aprovados após ${migrations.length} migrations reais.`
    );
  } finally {
    await disconnectPrisma?.();
    try {
      if (created) {
        assert.match(schema, safeSchema);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado de uso removido.");
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error("Falha nos testes SQL de uso:", error);
  process.exitCode = 1;
});
