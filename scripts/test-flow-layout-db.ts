/** PostgreSQL check for the versioned automation flow layout migration. */
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

const targetMigration = "20260910100000_add_versioned_flow_layout";
const schema = `replyflow_flow_test_${randomBytes(8).toString("hex")}`;
const safeSchema = /^replyflow_flow_test_[a-f0-9]{16}$/;

function databaseUrl() {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("Defina TEST_DATABASE_URL para um PostgreSQL local.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("O teste do mapa visual aceita somente PostgreSQL local.");
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
    assert.ok(targetIndex > 0, "Migration do mapa visual não encontrada.");
    for (const name of migrations.slice(0, targetIndex + 1)) {
      await client.query(await migrationSql(name));
    }

    const columns = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'Automation'
         AND column_name IN ('flowDefinition', 'flowRevision')
       ORDER BY column_name`
    );
    assert.deepEqual(columns.rows, [
      {
        column_name: "flowDefinition",
        data_type: "jsonb",
        is_nullable: "YES",
        column_default: null,
      },
      {
        column_name: "flowRevision",
        data_type: "integer",
        is_nullable: "NO",
        column_default: "0",
      },
    ]);

    const constraints = await client.query<{ conname: string; definition: string }>(
      `SELECT constraint_name AS conname,
              pg_get_constraintdef(pc.oid) AS definition
       FROM information_schema.table_constraints tc
       JOIN pg_constraint pc ON pc.conname = tc.constraint_name
       JOIN pg_namespace pn ON pn.oid = pc.connamespace
       WHERE tc.table_schema = current_schema()
         AND tc.table_name = 'Automation'
         AND tc.constraint_type = 'CHECK'
         AND pn.nspname = current_schema()
         AND tc.constraint_name IN (
           'Automation_flowRevision_nonnegative_check',
           'Automation_flowDefinition_object_check'
         )
       ORDER BY constraint_name`
    );
    assert.equal(constraints.rowCount, 2);
    assert.match(
      constraints.rows.find((row) => row.conname.includes("flowRevision"))
        ?.definition ?? "",
      /flowRevision.*>= 0/i
    );
    assert.match(
      constraints.rows.find((row) => row.conname.includes("flowDefinition"))
        ?.definition ?? "",
      /jsonb_typeof.*object/i
    );

    console.log(
      `Mapa visual: contrato SQL aprovado após ${targetIndex + 1} migrations reais.`
    );
  } finally {
    try {
      if (created) {
        assert.match(schema, safeSchema);
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        console.log("Schema isolado do mapa visual removido.");
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error("Falha nos testes SQL do mapa visual:", error);
  process.exitCode = 1;
});
