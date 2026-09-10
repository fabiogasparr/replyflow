ALTER TABLE "Automation"
  ADD COLUMN "flowDefinition" JSONB,
  ADD COLUMN "flowRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Automation"
  ADD CONSTRAINT "Automation_flowRevision_nonnegative_check"
    CHECK ("flowRevision" >= 0),
  ADD CONSTRAINT "Automation_flowDefinition_object_check"
    CHECK ("flowDefinition" IS NULL OR jsonb_typeof("flowDefinition") = 'object');
