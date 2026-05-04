CREATE TABLE "DeliverabilityAlert" (
  "id" BIGSERIAL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "meta" JSONB NOT NULL DEFAULT '{}',
  "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3)
);
CREATE INDEX "DeliverabilityAlert_kind_triggeredAt_idx"
  ON "DeliverabilityAlert"("kind", "triggeredAt");
CREATE INDEX "DeliverabilityAlert_resolvedAt_triggeredAt_idx"
  ON "DeliverabilityAlert"("resolvedAt", "triggeredAt");
