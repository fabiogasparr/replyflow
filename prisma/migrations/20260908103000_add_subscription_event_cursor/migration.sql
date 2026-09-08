ALTER TABLE "Subscription"
  ADD COLUMN "lastProviderEventAt" TIMESTAMP(3),
  ADD COLUMN "lastProviderEventId" TEXT;

CREATE INDEX "Subscription_provider_lastProviderEventAt_idx"
  ON "Subscription"("provider", "lastProviderEventAt");
