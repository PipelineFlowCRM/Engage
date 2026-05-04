import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import {
  QUEUE_AUDIENCE_COMPUTE,
  QUEUE_BROADCAST_BATCH,
  QUEUE_BROADCAST_LAUNCH,
  QUEUE_BROADCAST_SEND,
  QUEUE_CRM_ACTIVITY_PUSH,
  QUEUE_DELIVERABILITY_ROLLUP,
  QUEUE_EVENT_INGEST,
  QUEUE_GENERATE,
  QUEUE_JOURNEY_TICK,
  QUEUE_JOURNEY_TRIGGER,
  QUEUE_JOURNEY_WAIT_SWEEP,
  QUEUE_SES_QUOTA_POLL,
  type AudienceComputeJobData,
  type AudienceComputeJobResult,
  type BroadcastBatchJobData,
  type BroadcastLaunchJobData,
  type BroadcastSendJobData,
  type CrmActivityPushJobData,
  type EventIngestJobData,
  type EventIngestJobResult,
  type GenerateJobData,
  type GenerateJobResult,
  type JourneyTickJobData,
  type JourneyTriggerJobData,
  type SesQuotaPollJobData,
} from '@pipelineflow-engagement/shared';
import { env } from '../env.js';
import { logger } from './logger.js';

// BullMQ requires `maxRetriesPerRequest: null` on its connection.
export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
redisConnection.on('error', (err: Error) => {
  logger.error({ err }, 'redis connection error');
});

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 86_400 },
};

// ─── Event ingest ──────────────────────────────────────────────────────────
// Per-subscriber serialization handled by the producer using BullMQ groupId
// (see api/routes/public/track.ts). messageId-keyed jobId provides natural
// dedup at the broker level.
export const eventIngestQueue = new Queue<EventIngestJobData, EventIngestJobResult>(
  QUEUE_EVENT_INGEST,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 600, count: 5_000 },
      removeOnFail: { age: 7 * 86_400 },
    },
  },
);

// ─── Audience compute ─────────────────────────────────────────────────────
// One repeating schedule per audience, registered when the audience is
// created. Concurrency on the worker side is 1-per-audience via advisory lock.
const audienceComputeJobOptions: JobsOptions = {
  attempts: 1,                         // idempotent at row-level via computeVersion
  removeOnComplete: { age: 24 * 3_600, count: 50 },
  removeOnFail: { age: 7 * 86_400 },
};
export const audienceComputeQueue = new Queue<AudienceComputeJobData, AudienceComputeJobResult>(
  QUEUE_AUDIENCE_COMPUTE,
  { connection: redisConnection, defaultJobOptions: audienceComputeJobOptions },
);

// ─── Broadcasts ───────────────────────────────────────────────────────────
export const broadcastLaunchQueue = new Queue<BroadcastLaunchJobData>(
  QUEUE_BROADCAST_LAUNCH,
  { connection: redisConnection, defaultJobOptions },
);
export const broadcastBatchQueue = new Queue<BroadcastBatchJobData>(
  QUEUE_BROADCAST_BATCH,
  { connection: redisConnection, defaultJobOptions },
);
// Send queue uses higher attempt count + custom backoff for SES throttling.
export const broadcastSendQueue = new Queue<BroadcastSendJobData>(
  QUEUE_BROADCAST_SEND,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 6 * 3_600, count: 10_000 },
      removeOnFail: { age: 7 * 86_400 },
    },
  },
);

// ─── Deliverability rollup ───────────────────────────────────────────────
// Producer-side handle so Bull Board can list the queue. The repeating
// schedule is registered by the worker on boot.
export const deliverabilityRollupQueue = new Queue(QUEUE_DELIVERABILITY_ROLLUP, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 24 * 3_600, count: 50 },
    removeOnFail: { age: 7 * 86_400 },
  },
});

// ─── SES quota poll ──────────────────────────────────────────────────────
export const sesQuotaPollQueue = new Queue<SesQuotaPollJobData>(
  QUEUE_SES_QUOTA_POLL,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 3_600, count: 60 },
      removeOnFail: { age: 86_400 },
    },
  },
);

// ─── CRM activity push (Phase 2) ─────────────────────────────────────────
export const crmActivityPushQueue = new Queue<CrmActivityPushJobData>(
  QUEUE_CRM_ACTIVITY_PUSH,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 6,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 24 * 3_600, count: 5_000 },
      removeOnFail: { age: 7 * 86_400 },
    },
  },
);

// ─── Journey runner queues ────────────────────────────────────────────────
// Tick: advance one run by one node. Custom JobsOptions: keep attempts
// modest because the runner is row-locked and replay-safe via expectedNodeId.
export const journeyTickQueue = new Queue<JourneyTickJobData>(QUEUE_JOURNEY_TICK, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3_600, count: 5_000 },
    removeOnFail: { age: 7 * 86_400 },
  },
});
// Wait sweep: a recurring tick (every 30s) that fires timeout branches for
// JourneyWait rows whose expiresAt has passed. attempts=1 because the next
// tick picks up anything missed.
export const journeyWaitSweepQueue = new Queue(QUEUE_JOURNEY_WAIT_SWEEP, {
  connection: redisConnection,
  defaultJobOptions: { attempts: 1, removeOnComplete: { age: 3_600, count: 60 } },
});
// Trigger: starts a new run (or no-ops if one already exists for the
// (journey, subscriber, version) tuple). Producer is the audience compute
// job (audience-enter) and the events ingest worker (event entry match).
export const journeyTriggerQueue = new Queue<JourneyTriggerJobData>(
  QUEUE_JOURNEY_TRIGGER,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 3_600, count: 5_000 },
      removeOnFail: { age: 7 * 86_400 },
    },
  },
);

// ─── Smoke-test queue (env-gated) ────────────────────────────────────────
export const generateQueue = new Queue<GenerateJobData, GenerateJobResult>(
  QUEUE_GENERATE,
  { connection: redisConnection, defaultJobOptions },
);

export const allQueues = [
  eventIngestQueue,
  audienceComputeQueue,
  broadcastLaunchQueue,
  broadcastBatchQueue,
  broadcastSendQueue,
  sesQuotaPollQueue,
  crmActivityPushQueue,
  journeyTickQueue,
  journeyTriggerQueue,
  journeyWaitSweepQueue,
  deliverabilityRollupQueue,
  generateQueue,
];

// ─── Producer helpers ─────────────────────────────────────────────────────

export async function enqueueEventIngest(data: EventIngestJobData) {
  // Per-subscriber serialization: BullMQ Pro `group` isn't available in OSS,
  // so we fake it with a deterministic jobId scoped to the subscriber + a
  // ulid-ish suffix from the messageId. messageId is unique per event so
  // different events don't collide; events for the same subscriber arrive
  // in the same queue and the worker enforces serial trait merges via a
  // per-subscriber Postgres advisory lock at processing time.
  return eventIngestQueue.add(QUEUE_EVENT_INGEST, data, {
    jobId: data.messageId,
  });
}

export async function enqueueAudienceCompute(audienceId: number) {
  return audienceComputeQueue.add(QUEUE_AUDIENCE_COMPUTE, { audienceId });
}

/**
 * Idempotent register of the per-audience repeating compute schedule.
 * Call after audience create / status change. BullMQ dedupes repeatables
 * by (jobId, repeat config), so re-registering with the same interval is
 * a no-op; changing the interval requires unscheduleAudienceCompute first.
 */
export async function ensureAudienceComputeScheduled(audienceId: number, intervalSeconds: number) {
  const jobId = `recurring:audience-compute:${audienceId}`;
  await audienceComputeQueue.add(
    QUEUE_AUDIENCE_COMPUTE,
    { audienceId },
    {
      repeat: { every: intervalSeconds * 1_000 },
      jobId,
    },
  );
}

export async function unscheduleAudienceCompute(audienceId: number) {
  const wantedId = `recurring:audience-compute:${audienceId}`;
  const repeatables = await audienceComputeQueue.getRepeatableJobs();
  const target = repeatables.find((r) => r.id === wantedId);
  if (!target) return;
  await audienceComputeQueue.removeRepeatableByKey(target.key);
}

export async function enqueueBroadcastLaunch(broadcastId: number) {
  return broadcastLaunchQueue.add(QUEUE_BROADCAST_LAUNCH, { broadcastId }, {
    // One launch in flight per broadcast — pause/resume hits the same job id.
    jobId: `broadcast-launch:${broadcastId}`,
  });
}

export async function enqueueBroadcastBatch(data: BroadcastBatchJobData) {
  return broadcastBatchQueue.add(QUEUE_BROADCAST_BATCH, data);
}

export async function enqueueBroadcastSend(broadcastDeliveryId: bigint) {
  return broadcastSendQueue.add(QUEUE_BROADCAST_SEND, {
    broadcastDeliveryId: broadcastDeliveryId.toString(),
  });
}

/**
 * SES quota poller. 60-second cadence; first run on api boot.
 */
export async function ensureSesQuotaPollScheduled() {
  await sesQuotaPollQueue.add(
    QUEUE_SES_QUOTA_POLL,
    {},
    {
      repeat: { every: 60_000 },
      jobId: 'recurring:ses-quota-poll',
    },
  );
}

export async function enqueueCrmActivityPush(data: CrmActivityPushJobData) {
  if (!env.CRM_BASE_URL) return null;
  try {
    return await crmActivityPushQueue.add(QUEUE_CRM_ACTIVITY_PUSH, data);
  } catch (err) {
    logger.error({ err }, 'failed to enqueue crm-activity-push');
    return null;
  }
}

export async function closeQueues() {
  await Promise.allSettled(allQueues.map((q) => q.close()));
  await redisConnection.quit().catch(() => undefined);
}
