CREATE TYPE "ContactCustomFieldType" AS ENUM (
  'TEXT',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'SELECT'
);

CREATE TABLE "ContactFieldDefinition" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "type" "ContactCustomFieldType" NOT NULL,
  "options" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "position" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContactFieldDefinition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContactFieldDefinition_name_check"
    CHECK (CHAR_LENGTH(BTRIM("name")) BETWEEN 1 AND 60),
  CONSTRAINT "ContactFieldDefinition_normalizedName_check"
    CHECK (CHAR_LENGTH("normalizedName") BETWEEN 1 AND 60),
  CONSTRAINT "ContactFieldDefinition_position_check"
    CHECK ("position" >= 0),
  CONSTRAINT "ContactFieldDefinition_options_check"
    CHECK (
      ("type" = 'SELECT' AND CARDINALITY("options") BETWEEN 1 AND 20)
      OR ("type" <> 'SELECT' AND CARDINALITY("options") = 0)
    )
);

CREATE TABLE "ContactFieldValue" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "fieldDefinitionId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContactFieldValue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContactFieldValue_value_check"
    CHECK (CHAR_LENGTH("value") BETWEEN 1 AND 1000)
);

CREATE UNIQUE INDEX "Contact_id_workspaceId_key"
  ON "Contact"("id", "workspaceId");
CREATE UNIQUE INDEX "ContactFieldDefinition_workspaceId_normalizedName_key"
  ON "ContactFieldDefinition"("workspaceId", "normalizedName");
CREATE UNIQUE INDEX "ContactFieldDefinition_id_workspaceId_key"
  ON "ContactFieldDefinition"("id", "workspaceId");
CREATE INDEX "ContactFieldDefinition_workspaceId_isActive_position_idx"
  ON "ContactFieldDefinition"("workspaceId", "isActive", "position");
CREATE UNIQUE INDEX "ContactFieldValue_contactId_fieldDefinitionId_key"
  ON "ContactFieldValue"("contactId", "fieldDefinitionId");
CREATE INDEX "ContactFieldValue_workspaceId_fieldDefinitionId_idx"
  ON "ContactFieldValue"("workspaceId", "fieldDefinitionId");
CREATE INDEX "ContactFieldValue_contactId_idx"
  ON "ContactFieldValue"("contactId");

ALTER TABLE "ContactFieldDefinition"
  ADD CONSTRAINT "ContactFieldDefinition_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactFieldValue"
  ADD CONSTRAINT "ContactFieldValue_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactFieldValue"
  ADD CONSTRAINT "ContactFieldValue_contactId_workspaceId_fkey"
  FOREIGN KEY ("contactId", "workspaceId") REFERENCES "Contact"("id", "workspaceId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactFieldValue"
  ADD CONSTRAINT "ContactFieldValue_fieldDefinitionId_workspaceId_fkey"
  FOREIGN KEY ("fieldDefinitionId", "workspaceId")
  REFERENCES "ContactFieldDefinition"("id", "workspaceId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Rollback: first deploy application code that no longer reads custom fields.
-- Then publish a compensating migration that drops ContactFieldValue,
-- ContactFieldDefinition, Contact_id_workspaceId_key and the enum. Export any
-- customer values first because dropping the tables is destructive.
