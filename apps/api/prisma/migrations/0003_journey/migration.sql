-- Journey schema. Adds Journey, JourneyVersion, JourneyRun, JourneyRunStep,
-- JourneyWait. Run rows pin a versionId so an in-flight run isn't disrupted
-- by a definition edit.

CREATE TABLE "Journey" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "currentVersionId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "Journey_name_key" ON "Journey"("name");
CREATE UNIQUE INDEX "Journey_currentVersionId_key" ON "Journey"("currentVersionId");
CREATE INDEX "Journey_status_idx" ON "Journey"("status");

CREATE TABLE "JourneyVersion" (
  "id" SERIAL PRIMARY KEY,
  "journeyId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "definition" JSONB NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JourneyVersion_journeyId_fkey"
    FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "JourneyVersion_journeyId_version_key"
  ON "JourneyVersion"("journeyId", "version");

ALTER TABLE "Journey"
  ADD CONSTRAINT "Journey_currentVersionId_fkey"
    FOREIGN KEY ("currentVersionId") REFERENCES "JourneyVersion"("id")
    ON DELETE SET NULL;

CREATE TABLE "JourneyRun" (
  "id" BIGSERIAL PRIMARY KEY,
  "journeyId" INTEGER NOT NULL,
  "versionId" INTEGER NOT NULL,
  "subscriberId" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "currentNodeId" TEXT NOT NULL,
  "context" JSONB NOT NULL DEFAULT '{}',
  "scheduledFor" TIMESTAMP(3),
  "pendingJobId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "exitReason" TEXT,
  "errorMessage" TEXT,
  CONSTRAINT "JourneyRun_journeyId_fkey"
    FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE,
  CONSTRAINT "JourneyRun_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "JourneyVersion"("id"),
  CONSTRAINT "JourneyRun_subscriberId_fkey"
    FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "JourneyRun_journeyId_subscriberId_versionId_key"
  ON "JourneyRun"("journeyId", "subscriberId", "versionId");
CREATE INDEX "JourneyRun_status_scheduledFor_idx"
  ON "JourneyRun"("status", "scheduledFor");
CREATE INDEX "JourneyRun_journeyId_status_idx"
  ON "JourneyRun"("journeyId", "status");
CREATE INDEX "JourneyRun_subscriberId_idx" ON "JourneyRun"("subscriberId");

CREATE TABLE "JourneyRunStep" (
  "id" BIGSERIAL PRIMARY KEY,
  "runId" BIGINT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "nodeType" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "meta" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JourneyRunStep_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "JourneyRun"("id") ON DELETE CASCADE
);
CREATE INDEX "JourneyRunStep_runId_occurredAt_idx"
  ON "JourneyRunStep"("runId", "occurredAt");

CREATE TABLE "JourneyWait" (
  "id" BIGSERIAL PRIMARY KEY,
  "runId" BIGINT NOT NULL,
  "signalType" TEXT NOT NULL,
  "signalKey" TEXT NOT NULL,
  "predicate" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JourneyWait_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "JourneyRun"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "JourneyWait_runId_key" ON "JourneyWait"("runId");
CREATE INDEX "JourneyWait_signalType_signalKey_idx"
  ON "JourneyWait"("signalType", "signalKey");
CREATE INDEX "JourneyWait_expiresAt_idx" ON "JourneyWait"("expiresAt");
