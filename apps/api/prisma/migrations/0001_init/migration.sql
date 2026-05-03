-- Bootstrap migration. Generate with `prisma migrate dev --name init` against
-- a clean Postgres + Timescale; this hand-written file matches the schema.prisma
-- shape so Phase-1 deployments can `prisma migrate deploy` without an extra round-trip.
--
-- This file does NOT enable timescaledb or convert Event to a hypertable —
-- that lives in the 0002_event_hypertable migration so a Postgres-only
-- environment (e.g. CI without timescale image) can still apply 0001
-- and the test suite can opt out of 0002.

CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- AuthUser
CREATE TABLE "AuthUser" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'admin',
  "theme" TEXT NOT NULL DEFAULT 'system',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AuthUser_email_key" ON "AuthUser"("email");

-- Session
CREATE TABLE "Session" (
  "id" TEXT PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userAgent" TEXT,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- ApiToken
CREATE TABLE "ApiToken" (
  "id" TEXT PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "scopes" JSONB NOT NULL DEFAULT '[]',
  "lastUsedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE
);
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- Subscriber
CREATE TABLE "Subscriber" (
  "id" BIGSERIAL PRIMARY KEY,
  "externalId" TEXT NOT NULL,
  "anonymousIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "email" TEXT,
  "phone" TEXT,
  "traits" JSONB NOT NULL DEFAULT '{}',
  "source" TEXT NOT NULL DEFAULT 'api',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "Subscriber_externalId_key" ON "Subscriber"("externalId");
CREATE INDEX "Subscriber_email_idx" ON "Subscriber"("email");
CREATE INDEX "Subscriber_updatedAt_idx" ON "Subscriber"("updatedAt");
CREATE INDEX "Subscriber_source_idx" ON "Subscriber"("source");

-- SubscriberTrait
CREATE TABLE "SubscriberTrait" (
  "id" BIGSERIAL PRIMARY KEY,
  "subscriberId" BIGINT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "source" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriberTrait_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE
);
CREATE INDEX "SubscriberTrait_subscriberId_key_observedAt_idx" ON "SubscriberTrait"("subscriberId", "key", "observedAt");

-- Event
-- Composite PK on (id, receivedAt) is required by Timescale: any unique
-- constraint on a hypertable must include the partition key.
CREATE TABLE "Event" (
  "id" BIGSERIAL,
  "messageId" TEXT,
  "type" TEXT NOT NULL,
  "subscriberId" BIGINT,
  "anonymousId" TEXT,
  "externalId" TEXT,
  "name" TEXT,
  "properties" JSONB NOT NULL DEFAULT '{}',
  "context" JSONB NOT NULL DEFAULT '{}',
  "observedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY ("id", "receivedAt")
);
CREATE INDEX "Event_subscriberId_observedAt_idx" ON "Event"("subscriberId", "observedAt");
CREATE INDEX "Event_name_observedAt_idx" ON "Event"("name", "observedAt");
CREATE INDEX "Event_receivedAt_idx" ON "Event"("receivedAt");
-- Idempotency: messageId must be unique among non-null values. Partial
-- unique index because most events from older clients won't carry one.
CREATE UNIQUE INDEX "Event_messageId_key" ON "Event"("messageId") WHERE "messageId" IS NOT NULL;

-- Audience
CREATE TABLE "Audience" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "definition" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "computeIntervalSeconds" INTEGER NOT NULL DEFAULT 300,
  "lastComputedAt" TIMESTAMP(3),
  "lastComputeMs" INTEGER,
  "lastComputeError" TEXT,
  "memberCount" INTEGER NOT NULL DEFAULT 0,
  "computeVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "Audience_name_key" ON "Audience"("name");
CREATE INDEX "Audience_status_idx" ON "Audience"("status");

-- AudienceMember
CREATE TABLE "AudienceMember" (
  "audienceId" INTEGER NOT NULL,
  "subscriberId" BIGINT NOT NULL,
  "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "computeVersion" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("audienceId", "subscriberId"),
  CONSTRAINT "AudienceMember_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE CASCADE,
  CONSTRAINT "AudienceMember_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE
);
CREATE INDEX "AudienceMember_subscriberId_idx" ON "AudienceMember"("subscriberId");
CREATE INDEX "AudienceMember_audienceId_computeVersion_idx" ON "AudienceMember"("audienceId", "computeVersion");

-- SubscriptionGroup (defined before Template because Template FKs to it)
CREATE TABLE "SubscriptionGroup" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "type" TEXT NOT NULL DEFAULT 'opt_out',
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "SubscriptionGroup_name_key" ON "SubscriptionGroup"("name");

-- Template
CREATE TABLE "Template" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "definition" JSONB NOT NULL,
  "subscriptionGroupId" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Template_subscriptionGroupId_fkey" FOREIGN KEY ("subscriptionGroupId") REFERENCES "SubscriptionGroup"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "Template_name_key" ON "Template"("name");
CREATE INDEX "Template_status_idx" ON "Template"("status");

-- Broadcast
CREATE TABLE "Broadcast" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "templateId" INTEGER NOT NULL,
  "audienceId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "scheduledFor" TIMESTAMP(3),
  "snapshotTakenAt" TIMESTAMP(3),
  "totalRecipients" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "sendRatePerSecond" INTEGER NOT NULL DEFAULT 10,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "runJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Broadcast_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id"),
  CONSTRAINT "Broadcast_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id")
);
CREATE INDEX "Broadcast_status_idx" ON "Broadcast"("status");
CREATE INDEX "Broadcast_scheduledFor_idx" ON "Broadcast"("scheduledFor");

-- BroadcastDelivery
CREATE TABLE "BroadcastDelivery" (
  "id" BIGSERIAL PRIMARY KEY,
  "broadcastId" INTEGER NOT NULL,
  "subscriberId" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "skipReason" TEXT,
  "deliveryId" BIGINT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BroadcastDelivery_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "BroadcastDelivery_broadcastId_subscriberId_key" ON "BroadcastDelivery"("broadcastId", "subscriberId");
CREATE INDEX "BroadcastDelivery_broadcastId_status_idx" ON "BroadcastDelivery"("broadcastId", "status");

-- Delivery
CREATE TABLE "Delivery" (
  "id" BIGSERIAL PRIMARY KEY,
  "subscriberId" BIGINT NOT NULL,
  "templateId" INTEGER,
  "broadcastId" INTEGER,
  "journeyRunId" BIGINT,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "providerMessageId" TEXT,
  "toEmail" TEXT NOT NULL,
  "fromEmail" TEXT NOT NULL,
  "subject" TEXT,
  "meta" JSONB NOT NULL DEFAULT '{}',
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "clickedAt" TIMESTAMP(3),
  "bouncedAt" TIMESTAMP(3),
  "complainedAt" TIMESTAMP(3),
  "unsubscribedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Delivery_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE,
  CONSTRAINT "Delivery_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "Delivery_providerMessageId_key" ON "Delivery"("providerMessageId");
CREATE INDEX "Delivery_subscriberId_createdAt_idx" ON "Delivery"("subscriberId", "createdAt");
CREATE INDEX "Delivery_broadcastId_idx" ON "Delivery"("broadcastId");
CREATE INDEX "Delivery_status_createdAt_idx" ON "Delivery"("status", "createdAt");

-- SubscriptionState
CREATE TABLE "SubscriptionState" (
  "subscriberId" BIGINT NOT NULL,
  "groupId" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("subscriberId", "groupId"),
  CONSTRAINT "SubscriptionState_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE,
  CONSTRAINT "SubscriptionState_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SubscriptionGroup"("id") ON DELETE CASCADE
);
CREATE INDEX "SubscriptionState_groupId_status_idx" ON "SubscriptionState"("groupId", "status");

-- Suppression
CREATE TABLE "Suppression" (
  "email" TEXT PRIMARY KEY,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Secret
CREATE TABLE "Secret" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "encrypted" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "Secret_name_key" ON "Secret"("name");

-- Setting
CREATE TABLE "Setting" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

-- OperatorAuditEvent
CREATE TABLE "OperatorAuditEvent" (
  "id" BIGSERIAL PRIMARY KEY,
  "userId" INTEGER,
  "action" TEXT NOT NULL,
  "target" TEXT,
  "meta" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatorAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE SET NULL
);
CREATE INDEX "OperatorAuditEvent_action_createdAt_idx" ON "OperatorAuditEvent"("action", "createdAt");
CREATE INDEX "OperatorAuditEvent_userId_createdAt_idx" ON "OperatorAuditEvent"("userId", "createdAt");
