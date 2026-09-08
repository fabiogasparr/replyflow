/**
 * PostgreSQL checks for the billing foundation.
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

const targetMigration = "20260907180000_add_billing_foundation";
const schema = `replyflow_billing_test_${randomBytes(8).toString("hex")}`;
const safeSchema = /^replyflow_billing_test_[a-f0-9]{16}$/;

function databaseUrl() {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("O teste de cobrança aceita somente PostgreSQL em localhost.");
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

async function expectConstraintFailure(
  client: Client,
  savepoint: string,
  sql: string,
  expectedCode: string
) {
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(sql);
    assert.fail(`A restrição ${expectedCode} deveria bloquear a operação.`);
  } catch (error) {
    assert.equal((error as { code?: string }).code, expectedCode);
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }
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
    assert.ok(targetIndex > 0, "Migration de cobrança não encontrada.");
    for (const name of migrations.slice(0, targetIndex)) {
      await client.query(await migrationSql(name));
    }

    await client.query(`
      INSERT INTO "User" ("id", "email", "updatedAt")
        VALUES ('owner_1', 'owner@example.invalid', CURRENT_TIMESTAMP);
      INSERT INTO "Workspace" (
        "id", "name", "ownerId", "plan", "usagePeriodStart",
        "dmsSentThisPeriod", "updatedAt"
      ) VALUES
        ('workspace_1', 'Empresa A', 'owner_1', 'PRO', '2026-09-01', 42, CURRENT_TIMESTAMP),
        ('workspace_2', 'Empresa B', 'owner_1', 'FREE', '2026-09-01', 7, CURRENT_TIMESTAMP);
    `);

    await client.query(await migrationSql(targetMigration));

    const plans = (
      await client.query(
        `SELECT "code", "name", "monthlyPriceCents", "instagramAccounts", "members"
         FROM "Plan" ORDER BY "sortOrder"`
      )
    ).rows;
    assert.deepEqual(plans, [
      {
        code: "FREE",
        name: "Gratuito",
        monthlyPriceCents: 0,
        instagramAccounts: 1,
        members: 2,
      },
      {
        code: "PRO",
        name: "Pro",
        monthlyPriceCents: null,
        instagramAccounts: 3,
        members: 10,
      },
      {
        code: "AGENCY",
        name: "Agência",
        monthlyPriceCents: null,
        instagramAccounts: 10,
        members: 50,
      },
    ]);

    const subscriptions = (
      await client.query(
        `SELECT "workspaceId", "planCode", "provider", "status"
         FROM "Subscription" ORDER BY "workspaceId"`
      )
    ).rows;
    assert.deepEqual(subscriptions, [
      {
        workspaceId: "workspace_1",
        planCode: "PRO",
        provider: "MANUAL",
        status: "ACTIVE",
      },
      {
        workspaceId: "workspace_2",
        planCode: "FREE",
        provider: "MANUAL",
        status: "ACTIVE",
      },
    ]);

    const usage = (
      await client.query(
        `SELECT "workspaceId", "metric", "quantity"
         FROM "UsageRecord" ORDER BY "workspaceId"`
      )
    ).rows;
    assert.deepEqual(usage, [
      { workspaceId: "workspace_1", metric: "DM_SENT", quantity: 42 },
      { workspaceId: "workspace_2", metric: "DM_SENT", quantity: 7 },
    ]);

    const subscriptionId = subscriptions[0]
      ? (
          await client.query(
            `SELECT "id" FROM "Subscription" WHERE "workspaceId" = 'workspace_1'`
          )
        ).rows[0].id
      : assert.fail("Assinatura de backfill não encontrada.");

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "BillingEvent" (
        "id", "workspaceId", "subscriptionId", "provider", "providerEventId",
        "type", "occurredAt", "updatedAt"
      ) VALUES ('event_1', 'workspace_1', $1, 'MANUAL', 'manual_1',
        'subscription.created', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [subscriptionId]
    );

    await expectConstraintFailure(
      client,
      "duplicate_event",
      `INSERT INTO "BillingEvent" (
        "id", "workspaceId", "provider", "providerEventId", "type",
        "occurredAt", "updatedAt"
      ) VALUES ('event_2', 'workspace_1', 'MANUAL', 'manual_1',
        'subscription.created', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      "23505"
    );

    await expectConstraintFailure(
      client,
      "cross_workspace",
      `INSERT INTO "BillingEvent" (
        "id", "workspaceId", "subscriptionId", "provider", "providerEventId",
        "type", "occurredAt", "updatedAt"
      ) VALUES ('event_3', 'workspace_2', '${subscriptionId}', 'MANUAL',
        'manual_cross_workspace', 'subscription.updated', CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP)`,
      "23503"
    );

    await expectConstraintFailure(
      client,
      "negative_usage",
      `UPDATE "UsageRecord" SET "quantity" = -1
       WHERE "workspaceId" = 'workspace_1'`,
      "23514"
    );

    await client.query(`
      UPDATE "Subscription"
      SET "provider" = 'STRIPE', "providerCustomerId" = 'customer_shared'
      WHERE "workspaceId" = 'workspace_1';
      UPDATE "Subscription"
      SET "provider" = 'MERCADO_PAGO', "providerCustomerId" = 'customer_shared'
      WHERE "workspaceId" = 'workspace_2';
    `);
    await expectConstraintFailure(
      client,
      "provider_identity",
      `UPDATE "Subscription" SET "provider" = 'STRIPE'
       WHERE "workspaceId" = 'workspace_2'`,
      "23505"
    );

    await client.query(`DELETE FROM "Workspace" WHERE "id" = 'workspace_1'`);
    const remaining = await client.query(
      `SELECT
        (SELECT COUNT(*)::int FROM "Subscription" WHERE "workspaceId" = 'workspace_1') AS subscriptions,
        (SELECT COUNT(*)::int FROM "UsageRecord" WHERE "workspaceId" = 'workspace_1') AS usage,
        (SELECT COUNT(*)::int FROM "BillingEvent" WHERE "workspaceId" = 'workspace_1') AS events,
        (SELECT COUNT(*)::int FROM "Plan") AS plans`
    );
    assert.deepEqual(remaining.rows[0], {
      subscriptions: 0,
      usage: 0,
      events: 0,
      plans: 3,
    });

    console.log(
      `Cobrança: catálogo, backfill, idempotência, isolamento, validações e cascata aprovados após ${targetIndex + 1} migrations reais.`
    );
  } finally {
    try {
      await client.query("ROLLBACK");
      if (created) {
        assert.match(schema, safeSchema);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado de cobrança removido.");
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error("Falha nos testes SQL de cobrança:", error);
  process.exitCode = 1;
});
