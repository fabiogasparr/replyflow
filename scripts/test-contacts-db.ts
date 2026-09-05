/**
 * CRM database integration checks. Run with `npm run test:contacts-db`.
 * Only localhost PostgreSQL is accepted. Every object and fixture is created
 * under a fresh schema, which is removed in finally; application data is never
 * changed. TEST_DATABASE_URL takes precedence over the development DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Client, types } from "pg";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
config({ path: [path.join(projectRoot, ".env.local"), path.join(projectRoot, ".env")], quiet: true });
// Prisma stores DateTime in UTC timestamp-without-time-zone columns. pg's
// default parser otherwise interprets those values in the developer's timezone.
types.setTypeParser(1114, (value) => new Date(`${value.replace(" ", "T")}Z`));

const targetMigration = "20260905010000_add_contacts";
const schema = `replyflow_contacts_test_${randomBytes(8).toString("hex")}`;
const allowedSchemaPattern = /^replyflow_contacts_test_[a-f0-9]{16}$/;

function connectionString(): string {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("O teste de contatos aceita somente PostgreSQL em localhost.");
  }
  return value;
}

async function selectTestSchema(client: Client) {
  assert.match(schema, allowedSchemaPattern);
  // Do not include public: an accidentally missing migration must fail instead
  // of resolving a same-named table in the application's schema.
  await client.query(`SET search_path TO "${schema}", pg_catalog`);
  await client.query("SET TIME ZONE 'UTC'");
  await client.query("SET statement_timeout = '30s'");
  await client.query("SET lock_timeout = '10s'");
}

async function migrationSql(name: string) {
  const sql = await readFile(path.join(projectRoot, "prisma/migrations", name, "migration.sql"), "utf8");
  // The foundation migration has one public-schema bootstrap statement. All
  // actual DDL remains unchanged and resolves through our isolated search_path.
  const isolatedSql = sql.replace(/^CREATE SCHEMA IF NOT EXISTS "public";\s*$/m, "");
  assert.doesNotMatch(isolatedSql, /\bpublic\s*\.|"public"\s*\./i);
  assert.doesNotMatch(isolatedSql, /\bCREATE\s+SCHEMA\b/i);
  return isolatedSql;
}

type LogFixture = {
  id: string;
  workspaceId?: string;
  accountId?: string;
  automationId?: string;
  scopedId?: string;
  username?: string | null;
  createdAt?: string;
};

async function insertLog(client: Client, fixture: LogFixture) {
  await client.query(
    `INSERT INTO "DmLog" (
      "id", "workspaceId", "instagramAccountId", "automationId", "commenterId",
      "commenterName", "commentId", "commentText", "createdAt", "updatedAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $1, 'Comentário de teste', $7, CURRENT_TIMESTAMP)`,
    [fixture.id, fixture.workspaceId ?? "workspace_1", fixture.accountId ?? "account_1",
      fixture.automationId ?? "automation_1", fixture.scopedId ?? "same_person",
      fixture.username ?? null, fixture.createdAt ?? "2026-09-05T10:00:00.000Z"],
  );
}

type ContactRow = {
  id: string;
  username: string | null;
  usernameObservedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  updatedAt: Date;
  notes: string | null;
  tags: string[];
  version: number;
};

async function contact(client: Client, scopedId = "same_person") {
  const result = await client.query<ContactRow>(
    `SELECT * FROM "Contact" WHERE "workspaceId" = 'workspace_1'
      AND "instagramAccountId" = 'account_1' AND "instagramScopedId" = $1`,
    [scopedId],
  );
  assert.equal(result.rowCount, 1, "Uma única identidade deve produzir um único contato.");
  return result.rows[0];
}

async function expectSqlError(operation: () => Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === code,
  );
}

async function main() {
  const databaseUrl = connectionString();
  const client = new Client({ connectionString: databaseUrl });
  const concurrentClients: Client[] = [];
  let schemaCreated = false;
  await client.connect();
  try {
    assert.match(schema, allowedSchemaPattern);
    await client.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await selectTestSchema(client);

    const migrations = (await readdir(path.join(projectRoot, "prisma/migrations")))
      .filter((name) => /^\d{14}_/.test(name)).sort();
    const targetIndex = migrations.indexOf(targetMigration);
    assert.ok(targetIndex > 0, "Migration de contatos não encontrada.");
    for (const name of migrations.slice(0, targetIndex)) {
      await client.query(await migrationSql(name));
    }

    await client.query(`
      INSERT INTO "User" ("id", "email", "updatedAt")
        VALUES ('test_owner', 'contacts-test@example.invalid', CURRENT_TIMESTAMP);
      INSERT INTO "Workspace" ("id", "name", "ownerId", "updatedAt") VALUES
        ('workspace_1', 'Empresa 1', 'test_owner', CURRENT_TIMESTAMP),
        ('workspace_2', 'Empresa 2', 'test_owner', CURRENT_TIMESTAMP);
      INSERT INTO "InstagramAccount" ("id", "workspaceId", "instagramId", "username", "accessToken", "updatedAt") VALUES
        ('account_1', 'workspace_1', 'external_1', 'conta_um', 'test-placeholder', CURRENT_TIMESTAMP),
        ('account_2', 'workspace_1', 'external_2', 'conta_dois', 'test-placeholder', CURRENT_TIMESTAMP),
        ('account_3', 'workspace_2', 'external_3', 'conta_tres', 'test-placeholder', CURRENT_TIMESTAMP);
      INSERT INTO "Automation" ("id", "workspaceId", "instagramAccountId", "name", "keywords", "dmMessage", "updatedAt") VALUES
        ('automation_1', 'workspace_1', 'account_1', 'Automação 1', ARRAY['teste'], 'Olá', CURRENT_TIMESTAMP),
        ('automation_2', 'workspace_1', 'account_2', 'Automação 2', ARRAY['teste'], 'Olá', CURRENT_TIMESTAMP),
        ('automation_3', 'workspace_2', 'account_3', 'Automação 3', ARRAY['teste'], 'Olá', CURRENT_TIMESTAMP);
    `);
    await insertLog(client, { id: "history_old", username: "antigo", createdAt: "2026-09-01T10:00:00.000Z" });
    await insertLog(client, { id: "history_named", username: "  atual  ", createdAt: "2026-09-03T10:00:00.000Z" });
    await insertLog(client, { id: "history_anonymous", username: "   ", createdAt: "2026-09-04T10:00:00.000Z" });
    await insertLog(client, { id: "other_account", accountId: "account_2", automationId: "automation_2", username: "outra_conta" });
    await insertLog(client, { id: "other_workspace", workspaceId: "workspace_2", accountId: "account_3", automationId: "automation_3", username: "outra_empresa" });

    // The old schema permits inconsistent ownership. The migration must stop
    // without leaving partially created CRM objects behind.
    await insertLog(client, { id: "legacy_mismatch", workspaceId: "workspace_2" });
    const contactsMigrationSql = await migrationSql(targetMigration);
    await expectSqlError(() => client.query(contactsMigrationSql), "P0001");
    await client.query("ROLLBACK");
    const rolledBack = await client.query("SELECT to_regclass($1) AS relation", [`${schema}."Contact"`]);
    assert.equal(rolledBack.rows[0].relation, null);
    await client.query('DELETE FROM "DmLog" WHERE "id" = $1', ["legacy_mismatch"]);
    await client.query(contactsMigrationSql);

    const historical = await contact(client);
    assert.equal(historical.username, "atual");
    assert.equal(historical.usernameObservedAt?.toISOString(), "2026-09-03T10:00:00.000Z");
    assert.equal(historical.firstSeenAt.toISOString(), "2026-09-01T10:00:00.000Z");
    assert.equal(historical.lastSeenAt.toISOString(), "2026-09-04T10:00:00.000Z");
    assert.equal((await client.query('SELECT COUNT(*)::INT AS count FROM "Contact"')).rows[0].count, 3);
    console.log("✓ Migration atômica, backfill e isolamento por empresa/conta");

    await client.query(`UPDATE "Contact" SET "notes" = 'Nota da equipe', "tags" = ARRAY['vip'],
      "version" = 7 WHERE "id" = $1`, [historical.id]);
    await insertLog(client, { id: "out_of_order_old", username: "obsoleto", createdAt: "2026-08-01T10:00:00.000Z" });
    await insertLog(client, { id: "new_anonymous", createdAt: "2026-09-06T10:00:00.000Z" });
    await insertLog(client, { id: "new_named", username: "novo_nome", createdAt: "2026-09-05T10:00:00.000Z" });
    await client.query('UPDATE "DmLog" SET "commenterName" = $1 WHERE "id" = $2', ["nome_antigo_corrigido", "history_old"]);
    const current = await contact(client);
    assert.equal(current.firstSeenAt.toISOString(), "2026-08-01T10:00:00.000Z");
    assert.equal(current.lastSeenAt.toISOString(), "2026-09-06T10:00:00.000Z");
    assert.equal(current.username, "novo_nome");
    assert.equal(current.usernameObservedAt?.toISOString(), "2026-09-05T10:00:00.000Z");
    assert.equal(current.notes, "Nota da equipe");
    assert.deepEqual(current.tags, ["vip"]);
    assert.equal(current.version, 7);

    // A same-value replay and send-status retries do not touch the projection.
    await client.query(`UPDATE "DmLog" SET "commenterName" = "commenterName", "attempts" = 4,
      "status" = 'SENT', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 'new_named'`);
    assert.deepEqual(await contact(client), current);
    await client.query('UPDATE "DmLog" SET "commenterName" = $1 WHERE "id" = $2', ["nome_corrigido", "new_named"]);
    assert.equal((await contact(client)).username, "nome_corrigido");
    await client.query('UPDATE "DmLog" SET "commenterName" = NULL WHERE "id" = $1', ["new_named"]);
    assert.equal((await contact(client)).username, "nome_corrigido");
    await expectSqlError(() => insertLog(client, { id: "new_named" }), "23505");
    console.log("✓ Eventos fora de ordem, nomes opcionais, replay e preservação de edições");

    await expectSqlError(() => client.query(`INSERT INTO "Contact" (
      "id", "workspaceId", "instagramAccountId", "instagramScopedId", "firstSeenAt", "lastSeenAt", "updatedAt"
    ) VALUES ('invalid_contact', 'workspace_2', 'account_1', 'foreign_person', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`), "23503");
    await expectSqlError(() => insertLog(client, { id: "invalid_log", workspaceId: "workspace_2" }), "23503");
    assert.equal((await client.query('SELECT COUNT(*)::INT AS count FROM "DmLog" WHERE "id" = $1', ["invalid_log"])).rows[0].count, 0);

    // The SQL upsert must serialize competing arrivals for the same identity.
    for (let index = 0; index < 2; index += 1) {
      const concurrent = new Client({ connectionString: databaseUrl });
      await concurrent.connect();
      concurrentClients.push(concurrent);
      await selectTestSchema(concurrent);
    }
    await Promise.all([
      insertLog(concurrentClients[0], { id: "concurrent_new", scopedId: "concurrent_person", username: "mais_recente", createdAt: "2026-09-05T10:00:00.000Z" }),
      insertLog(concurrentClients[1], { id: "concurrent_old", scopedId: "concurrent_person", username: "mais_antigo", createdAt: "2026-09-01T10:00:00.000Z" }),
    ]);
    const concurrentContact = await contact(client, "concurrent_person");
    assert.equal(concurrentContact.username, "mais_recente");
    assert.equal(concurrentContact.firstSeenAt.toISOString(), "2026-09-01T10:00:00.000Z");
    assert.equal(concurrentContact.lastSeenAt.toISOString(), "2026-09-05T10:00:00.000Z");
    assert.equal(concurrentContact.version, 0);
    console.log("✓ FK composta, falha atômica do log e ingestão concorrente");

    // Removing campaign history keeps manual CRM context; removing its account
    // removes only that account's contacts through the composite FK.
    await client.query('DELETE FROM "Automation" WHERE "id" = $1', ["automation_1"]);
    assert.equal((await contact(client)).notes, "Nota da equipe");
    await client.query('DELETE FROM "InstagramAccount" WHERE "id" = $1', ["account_1"]);
    assert.equal((await client.query('SELECT COUNT(*)::INT AS count FROM "Contact"')).rows[0].count, 2);
    console.log("✓ Retenção das notas e exclusão em cascata limitada à conta");
    console.log(`Contatos: testes SQL aprovados após ${targetIndex + 1} migrations reais.`);
  } finally {
    await Promise.allSettled(concurrentClients.map((concurrent) => concurrent.end()));
    try {
      await client.query("ROLLBACK");
      if (schemaCreated) {
        assert.match(schema, allowedSchemaPattern);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado de teste removido.");
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error: unknown) => {
  // Keep the full PostgreSQL error (code, detail and stack) visible in CI.
  console.error("Falha nos testes SQL de contatos:", error);
  process.exitCode = 1;
});
