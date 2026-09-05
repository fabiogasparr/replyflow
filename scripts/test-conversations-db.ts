/**
 * Database isolation checks for team conversation state.
 * Runs every real migration in a disposable schema on localhost PostgreSQL.
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
const schema = `replyflow_conversations_test_${randomBytes(8).toString("hex")}`;
const safeSchema = /^replyflow_conversations_test_[a-f0-9]{16}$/;

function databaseUrl() {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("O teste de conversas aceita somente PostgreSQL em localhost.");
  }
  return value;
}

async function isolatedMigration(name: string) {
  const sql = await readFile(path.join(projectRoot, "prisma/migrations", name, "migration.sql"), "utf8");
  const isolated = sql.replace(/^CREATE SCHEMA IF NOT EXISTS "public";\s*$/m, "");
  assert.doesNotMatch(isolated, /\bpublic\s*\.|"public"\s*\./i);
  assert.doesNotMatch(isolated, /\bCREATE\s+SCHEMA\b/i);
  return isolated;
}

async function expectSqlError(operation: () => Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === code,
  );
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
      .filter((name) => /^\d{14}_/.test(name)).sort();
    const targetIndex = migrations.indexOf("20260905020000_add_conversation_state");
    assert.ok(targetIndex > 0, "Migration de conversas não encontrada.");
    for (const name of migrations.slice(0, targetIndex + 1)) {
      await client.query(await isolatedMigration(name));
    }

    await client.query(`
      INSERT INTO "User" ("id", "email", "updatedAt") VALUES
        ('owner_1', 'owner-1@example.invalid', CURRENT_TIMESTAMP),
        ('owner_2', 'owner-2@example.invalid', CURRENT_TIMESTAMP),
        ('agent_1', 'agent-1@example.invalid', CURRENT_TIMESTAMP),
        ('agent_2', 'agent-2@example.invalid', CURRENT_TIMESTAMP);
      INSERT INTO "Workspace" ("id", "name", "ownerId", "updatedAt") VALUES
        ('workspace_1', 'Empresa 1', 'owner_1', CURRENT_TIMESTAMP),
        ('workspace_2', 'Empresa 2', 'owner_2', CURRENT_TIMESTAMP);
      INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role") VALUES
        ('member_1', 'workspace_1', 'agent_1', 'MEMBER'),
        ('member_2', 'workspace_2', 'agent_2', 'MEMBER');
      INSERT INTO "InstagramAccount" ("id", "workspaceId", "instagramId", "username", "accessToken", "updatedAt") VALUES
        ('account_1', 'workspace_1', 'business_1', 'empresa_um', 'placeholder', CURRENT_TIMESTAMP),
        ('account_2', 'workspace_2', 'business_2', 'empresa_dois', 'placeholder', CURRENT_TIMESTAMP);
      INSERT INTO "Contact" (
        "id", "workspaceId", "instagramAccountId", "instagramScopedId",
        "firstSeenAt", "lastSeenAt", "updatedAt"
      ) VALUES
        ('contact_1', 'workspace_1', 'account_1', 'person_1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('contact_2', 'workspace_2', 'account_2', 'person_2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "Conversation" (
        "id", "workspaceId", "instagramAccountId", "contactId", "metaConversationId",
        "assignedMemberId", "lastSyncedAt", "updatedAt"
      ) VALUES (
        'conversation_1', 'workspace_1', 'account_1', 'contact_1', 'meta_1',
        'member_1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
    `);

    await expectSqlError(() => client.query(`INSERT INTO "Conversation" (
      "id", "workspaceId", "instagramAccountId", "contactId", "metaConversationId", "updatedAt"
    ) VALUES ('duplicate', 'workspace_1', 'account_1', 'contact_1', 'meta_1', CURRENT_TIMESTAMP)`), "23505");
    await expectSqlError(() => client.query(`INSERT INTO "Conversation" (
      "id", "workspaceId", "instagramAccountId", "contactId", "metaConversationId", "updatedAt"
    ) VALUES ('foreign_contact', 'workspace_1', 'account_1', 'contact_2', 'meta_2', CURRENT_TIMESTAMP)`), "23503");
    await expectSqlError(() => client.query(`INSERT INTO "Conversation" (
      "id", "workspaceId", "instagramAccountId", "contactId", "metaConversationId", "updatedAt"
    ) VALUES ('foreign_account', 'workspace_2', 'account_1', 'contact_1', 'meta_3', CURRENT_TIMESTAMP)`), "23503");
    await expectSqlError(() => client.query(
      `UPDATE "Conversation" SET "assignedMemberId" = 'member_2' WHERE "id" = 'conversation_1'`,
    ), "23503");
    console.log("✓ Conversa, contato, conta e responsável isolados por workspace");

    await expectSqlError(() => client.query(`DELETE FROM "WorkspaceMember" WHERE "id" = 'member_1'`), "23503");
    await client.query(`UPDATE "Conversation" SET "assignedMemberId" = NULL, "version" = "version" + 1 WHERE "id" = 'conversation_1'`);
    await client.query(`DELETE FROM "WorkspaceMember" WHERE "id" = 'member_1'`);
    assert.equal((await client.query(`SELECT "version" FROM "Conversation" WHERE "id" = 'conversation_1'`)).rows[0].version, 1);
    console.log("✓ Remoção de responsável exige desatribuição explícita e versionada");

    await client.query(`DELETE FROM "InstagramAccount" WHERE "id" = 'account_1'`);
    assert.equal((await client.query(`SELECT COUNT(*)::INT AS count FROM "Conversation"`)).rows[0].count, 0);
    assert.equal((await client.query(`SELECT COUNT(*)::INT AS count FROM "Contact" WHERE "workspaceId" = 'workspace_2'`)).rows[0].count, 1);
    console.log(`Conversas: isolamento aprovado após ${targetIndex + 1} migrations reais.`);
  } finally {
    try {
      await client.query("ROLLBACK");
      if (created) {
        assert.match(schema, safeSchema);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado de conversas removido.");
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error("Falha nos testes SQL de conversas:", error);
  process.exitCode = 1;
});
