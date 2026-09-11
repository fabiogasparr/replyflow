/**
 * Contact custom-field database checks. Runs every real migration inside a
 * disposable localhost PostgreSQL schema and removes it in finally.
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

const targetMigration = "20260911130000_add_contact_custom_fields";
const schema = `replyflow_fields_test_${randomBytes(8).toString("hex")}`;
const allowedSchemaPattern = /^replyflow_fields_test_[a-f0-9]{16}$/;

function connectionString() {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("O teste de campos personalizados aceita somente PostgreSQL em localhost.");
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

async function expectSqlError(operation: () => Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === code,
  );
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
    assert.equal(migrations.at(-1), targetMigration, "A migration de campos deve ser a mais recente.");
    for (const name of migrations) await client.query(await migrationSql(name));

    await client.query(`
      INSERT INTO "User" ("id", "email", "updatedAt")
        VALUES ('fields_owner', 'fields-test@example.invalid', CURRENT_TIMESTAMP);
      INSERT INTO "Workspace" ("id", "name", "ownerId", "updatedAt") VALUES
        ('fields_workspace_1', 'Empresa 1', 'fields_owner', CURRENT_TIMESTAMP),
        ('fields_workspace_2', 'Empresa 2', 'fields_owner', CURRENT_TIMESTAMP);
      INSERT INTO "InstagramAccount" ("id", "workspaceId", "instagramId", "username", "accessToken", "updatedAt") VALUES
        ('fields_account_1', 'fields_workspace_1', 'fields_external_1', 'conta_um', 'test-placeholder', CURRENT_TIMESTAMP),
        ('fields_account_2', 'fields_workspace_2', 'fields_external_2', 'conta_dois', 'test-placeholder', CURRENT_TIMESTAMP);
      INSERT INTO "Automation" ("id", "workspaceId", "instagramAccountId", "name", "keywords", "dmMessage", "updatedAt") VALUES
        ('fields_automation_1', 'fields_workspace_1', 'fields_account_1', 'Automação 1', ARRAY['teste'], 'Olá', CURRENT_TIMESTAMP),
        ('fields_automation_2', 'fields_workspace_2', 'fields_account_2', 'Automação 2', ARRAY['teste'], 'Olá', CURRENT_TIMESTAMP);
      INSERT INTO "DmLog" (
        "id", "workspaceId", "instagramAccountId", "automationId", "commenterId",
        "commentId", "commentText", "updatedAt"
      ) VALUES
        ('fields_log_1', 'fields_workspace_1', 'fields_account_1', 'fields_automation_1', 'person_1', 'comment_1', 'Olá', CURRENT_TIMESTAMP),
        ('fields_log_2', 'fields_workspace_2', 'fields_account_2', 'fields_automation_2', 'person_2', 'comment_2', 'Olá', CURRENT_TIMESTAMP);
      INSERT INTO "ContactFieldDefinition" (
        "id", "workspaceId", "name", "normalizedName", "type", "options", "position", "updatedAt"
      ) VALUES
        ('field_city', 'fields_workspace_1', 'Cidade', 'cidade', 'TEXT', ARRAY[]::TEXT[], 0, CURRENT_TIMESTAMP),
        ('field_stage', 'fields_workspace_1', 'Etapa', 'etapa', 'SELECT', ARRAY['Novo', 'Cliente'], 1, CURRENT_TIMESTAMP),
        ('field_foreign', 'fields_workspace_2', 'Cidade', 'cidade', 'TEXT', ARRAY[]::TEXT[], 0, CURRENT_TIMESTAMP);
    `);
    const contacts = await client.query<{ id: string; workspaceId: string }>(
      `SELECT "id", "workspaceId" FROM "Contact" ORDER BY "workspaceId"`,
    );
    const firstContact = contacts.rows.find((row) => row.workspaceId === "fields_workspace_1")!;
    const secondContact = contacts.rows.find((row) => row.workspaceId === "fields_workspace_2")!;

    await client.query(`INSERT INTO "ContactFieldValue" (
      "id", "workspaceId", "contactId", "fieldDefinitionId", "value", "updatedAt"
    ) VALUES ('value_city', 'fields_workspace_1', $1, 'field_city', 'São Paulo', CURRENT_TIMESTAMP)`, [firstContact.id]);
    assert.equal((await client.query(`SELECT COUNT(*)::INT AS count FROM "ContactFieldValue"`)).rows[0].count, 1);

    await expectSqlError(() => client.query(`INSERT INTO "ContactFieldDefinition" (
      "id", "workspaceId", "name", "normalizedName", "type", "options", "updatedAt"
    ) VALUES ('duplicate_city', 'fields_workspace_1', 'CIDADE', 'cidade', 'TEXT', ARRAY[]::TEXT[], CURRENT_TIMESTAMP)`), "23505");
    await expectSqlError(() => client.query(`INSERT INTO "ContactFieldDefinition" (
      "id", "workspaceId", "name", "normalizedName", "type", "options", "updatedAt"
    ) VALUES ('invalid_options', 'fields_workspace_1', 'Inválido', 'inválido', 'TEXT', ARRAY['A'], CURRENT_TIMESTAMP)`), "23514");
    await expectSqlError(() => client.query(`INSERT INTO "ContactFieldValue" (
      "id", "workspaceId", "contactId", "fieldDefinitionId", "value", "updatedAt"
    ) VALUES ('cross_field', 'fields_workspace_1', $1, 'field_foreign', 'X', CURRENT_TIMESTAMP)`, [firstContact.id]), "23503");
    await expectSqlError(() => client.query(`INSERT INTO "ContactFieldValue" (
      "id", "workspaceId", "contactId", "fieldDefinitionId", "value", "updatedAt"
    ) VALUES ('cross_contact', 'fields_workspace_1', $1, 'field_city', 'X', CURRENT_TIMESTAMP)`, [secondContact.id]), "23503");

    await client.query(`UPDATE "ContactFieldDefinition" SET "isActive" = false WHERE "id" = 'field_city'`);
    assert.equal((await client.query(`SELECT COUNT(*)::INT AS count FROM "ContactFieldValue"
      WHERE "id" = 'value_city'`)).rows[0].count, 1, "Desativar a definição deve preservar valores históricos.");
    await client.query(`DELETE FROM "Contact" WHERE "id" = $1`, [firstContact.id]);
    assert.equal((await client.query(`SELECT COUNT(*)::INT AS count FROM "ContactFieldValue"
      WHERE "id" = 'value_city'`)).rows[0].count, 0, "Excluir o contato deve remover seus valores em cascata.");

    console.log(`✓ Campos personalizados: constraints, isolamento e cascata aprovados após ${migrations.length} migrations reais.`);
  } finally {
    try {
      await client.query("ROLLBACK");
      if (schemaCreated) {
        assert.match(schema, allowedSchemaPattern);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado de campos personalizados removido.");
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
