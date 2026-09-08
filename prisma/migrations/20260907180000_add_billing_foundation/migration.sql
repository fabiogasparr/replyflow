CREATE TYPE "SubscriptionStatus" AS ENUM (
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'INCOMPLETE'
);

CREATE TYPE "BillingProvider" AS ENUM ('MANUAL', 'MERCADO_PAGO', 'STRIPE');

CREATE TYPE "BillingEventStatus" AS ENUM (
  'PENDING',
  'PROCESSED',
  'FAILED',
  'IGNORED'
);

CREATE TYPE "UsageMetric" AS ENUM ('DM_SENT');

CREATE TABLE "Plan" (
  "code" "WorkspacePlan" NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "monthlyPriceCents" INTEGER,
  "monthlyDmLimit" INTEGER NOT NULL,
  "instagramAccounts" INTEGER NOT NULL,
  "members" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Plan_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "planCode" "WorkspacePlan" NOT NULL DEFAULT 'FREE',
  "provider" "BillingProvider" NOT NULL DEFAULT 'MANUAL',
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "providerCustomerId" TEXT,
  "providerSubscriptionId" TEXT,
  "trialEndsAt" TIMESTAMP(3),
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageRecord" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "metric" "UsageMetric" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "provider" "BillingProvider" NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" "BillingEventStatus" NOT NULL DEFAULT 'PENDING',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_workspaceId_key"
  ON "Subscription"("workspaceId");
CREATE UNIQUE INDEX "Subscription_id_workspaceId_key"
  ON "Subscription"("id", "workspaceId");
CREATE UNIQUE INDEX "Subscription_provider_providerCustomerId_key"
  ON "Subscription"("provider", "providerCustomerId");
CREATE UNIQUE INDEX "Subscription_provider_providerSubscriptionId_key"
  ON "Subscription"("provider", "providerSubscriptionId");
CREATE INDEX "Subscription_planCode_status_idx"
  ON "Subscription"("planCode", "status");
CREATE INDEX "Subscription_provider_status_idx"
  ON "Subscription"("provider", "status");

CREATE UNIQUE INDEX "UsageRecord_workspaceId_metric_periodStart_key"
  ON "UsageRecord"("workspaceId", "metric", "periodStart");
CREATE INDEX "UsageRecord_workspaceId_periodStart_periodEnd_idx"
  ON "UsageRecord"("workspaceId", "periodStart", "periodEnd");

CREATE UNIQUE INDEX "BillingEvent_provider_providerEventId_key"
  ON "BillingEvent"("provider", "providerEventId");
CREATE INDEX "BillingEvent_workspaceId_createdAt_idx"
  ON "BillingEvent"("workspaceId", "createdAt");
CREATE INDEX "BillingEvent_status_createdAt_idx"
  ON "BillingEvent"("status", "createdAt");

CREATE INDEX "Plan_isActive_sortOrder_idx"
  ON "Plan"("isActive", "sortOrder");

ALTER TABLE "Plan"
  ADD CONSTRAINT "Plan_monthlyPriceCents_check"
    CHECK ("monthlyPriceCents" IS NULL OR "monthlyPriceCents" >= 0),
  ADD CONSTRAINT "Plan_monthlyDmLimit_check"
    CHECK ("monthlyDmLimit" > 0),
  ADD CONSTRAINT "Plan_instagramAccounts_check"
    CHECK ("instagramAccounts" > 0),
  ADD CONSTRAINT "Plan_members_check"
    CHECK ("members" > 0),
  ADD CONSTRAINT "Plan_sortOrder_check"
    CHECK ("sortOrder" >= 0);

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_currentPeriod_check"
    CHECK (
      "currentPeriodStart" IS NULL OR
      "currentPeriodEnd" IS NULL OR
      "currentPeriodEnd" > "currentPeriodStart"
    );

ALTER TABLE "UsageRecord"
  ADD CONSTRAINT "UsageRecord_quantity_check" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "UsageRecord_period_check" CHECK ("periodEnd" > "periodStart");

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_planCode_fkey"
  FOREIGN KEY ("planCode") REFERENCES "Plan"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UsageRecord"
  ADD CONSTRAINT "UsageRecord_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingEvent"
  ADD CONSTRAINT "BillingEvent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingEvent"
  ADD CONSTRAINT "BillingEvent_subscriptionId_workspaceId_fkey"
  FOREIGN KEY ("subscriptionId", "workspaceId")
  REFERENCES "Subscription"("id", "workspaceId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Plan" (
  "code", "name", "currency", "monthlyPriceCents", "monthlyDmLimit",
  "instagramAccounts", "members", "isActive", "sortOrder", "updatedAt"
) VALUES
  ('FREE', 'Gratuito', 'BRL', 0, 2000000000, 1, 2, true, 10, CURRENT_TIMESTAMP),
  ('PRO', 'Pro', 'BRL', NULL, 2000000000, 3, 10, true, 20, CURRENT_TIMESTAMP),
  ('AGENCY', 'Agência', 'BRL', NULL, 2000000000, 10, 50, true, 30, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Subscription" (
  "id", "workspaceId", "planCode", "provider", "status",
  "currentPeriodStart", "createdAt", "updatedAt"
)
SELECT
  'sub_backfill_' || md5("id"),
  "id",
  "plan",
  'MANUAL',
  'ACTIVE',
  "usagePeriodStart",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Workspace"
ON CONFLICT ("workspaceId") DO NOTHING;

INSERT INTO "UsageRecord" (
  "id", "workspaceId", "metric", "periodStart", "periodEnd", "quantity",
  "createdAt", "updatedAt"
)
SELECT
  'usage_backfill_' || md5("id" || "usagePeriodStart"::text),
  "id",
  'DM_SENT',
  "usagePeriodStart",
  "usagePeriodStart" + INTERVAL '1 month',
  "dmsSentThisPeriod",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Workspace"
ON CONFLICT ("workspaceId", "metric", "periodStart") DO NOTHING;
