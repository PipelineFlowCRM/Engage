// Worker entry. One BullMQ Worker per queue; concurrency tuned per queue.

import { Worker, Queue, QueueEvents, type Job } from 'bullmq';
import {
  QUEUE_AUDIENCE_COMPUTE,
  QUEUE_BROADCAST_BATCH,
  QUEUE_BROADCAST_LAUNCH,
  QUEUE_BROADCAST_SEND,
  QUEUE_CRM_ACTIVITY_PUSH,
  QUEUE_EVENT_INGEST,
  QUEUE_JOURNEY_TICK,
  QUEUE_JOURNEY_TRIGGER,
  QUEUE_JOURNEY_WAIT_SWEEP,
  QUEUE_SES_QUOTA_POLL,
} from '@pipelineflow-engagement/shared';
import { env } from './env.js';
import { logger } from './logger.js';
import { redisConnection } from './lib/redis.js';
import { prisma } from './db.js';
import { processEventIngest } from './jobs/eventIngest.js';
import { processAudienceCompute } from './jobs/audienceCompute.js';
import { processBroadcastLaunch } from './jobs/broadcastLaunch.js';
import { processBroadcastBatch } from './jobs/broadcastBatch.js';
import { processBroadcastSend } from './jobs/broadcastSend.js';
import { processSesQuotaPoll } from './jobs/sesQuotaPoll.js';
import { processCrmActivityPush } from './jobs/crmActivityPush.js';
import { processJourneyTick } from './jobs/journeyTick.js';
import { processJourneyTrigger } from './jobs/journeyTrigger.js';
import { processJourneyWaitSweep } from './jobs/journeyWaitSweep.js';

const concurrency = env.WORKER_CONCURRENCY;

const workers = [
  new Worker(QUEUE_EVENT_INGEST, processEventIngest, {
    connection: redisConnection,
    concurrency: concurrency * 2,
  }),
  new Worker(QUEUE_AUDIENCE_COMPUTE, processAudienceCompute, {
    connection: redisConnection,
    // 1 — advisory locks serialise per-audience anyway, but parallel
    // computes against the events table aren't free either.
    concurrency: 2,
  }),
  new Worker(QUEUE_BROADCAST_LAUNCH, processBroadcastLaunch, {
    connection: redisConnection,
    concurrency: 2,
  }),
  new Worker(QUEUE_BROADCAST_BATCH, processBroadcastBatch, {
    connection: redisConnection,
    concurrency: 4,
  }),
  new Worker(QUEUE_BROADCAST_SEND, processBroadcastSend, {
    connection: redisConnection,
    concurrency,
    // Per-broadcast rate limiting is enforced at the queue level by an
    // operator-set sendRatePerSecond on the Broadcast row. For Phase 1 we
    // just cap the global send concurrency; per-broadcast pacing rides
    // along with the Broadcast.sendRatePerSecond enforcement that the
    // launch worker honours when fanning out.
  }),
  new Worker(QUEUE_SES_QUOTA_POLL, processSesQuotaPoll, {
    connection: redisConnection,
    concurrency: 1,
  }),
  new Worker(QUEUE_CRM_ACTIVITY_PUSH, processCrmActivityPush, {
    connection: redisConnection,
    concurrency: 2,
  }),
  // Journey runner. Tick processes one run at a time per id (the row-level
  // lock makes any concurrency level safe), but we cap to keep DB pool
  // pressure manageable.
  new Worker(QUEUE_JOURNEY_TICK, processJourneyTick, {
    connection: redisConnection,
    concurrency,
  }),
  new Worker(QUEUE_JOURNEY_TRIGGER, processJourneyTrigger, {
    connection: redisConnection,
    concurrency: 4,
  }),
  new Worker(QUEUE_JOURNEY_WAIT_SWEEP, processJourneyWaitSweep, {
    connection: redisConnection,
    concurrency: 1,
  }),
];

// Register the wait-sweep cron once on boot. BullMQ dedupes repeatables by
// jobId, so multi-instance worker deploys converge on a single schedule.
const waitSweepQueue = new Queue(QUEUE_JOURNEY_WAIT_SWEEP, { connection: redisConnection });
void waitSweepQueue
  .add(
    QUEUE_JOURNEY_WAIT_SWEEP,
    {},
    {
      repeat: { every: 30_000 },
      jobId: 'recurring:journey-wait-sweep',
    },
  )
  .catch((err) => logger.error({ err }, 'failed to register journey-wait-sweep schedule'));

for (const w of workers) {
  w.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(
      { queue: w.name, jobId: job?.id, attempts: job?.attemptsMade, err },
      'job failed',
    );
  });
  w.on('error', (err: Error) => {
    logger.error({ queue: w.name, err }, 'worker error');
  });
}

logger.info({ workers: workers.map((w) => w.name), concurrency }, 'worker started');

// ─── BullMQ "broadcastDelivery → failed" hook ──────────────────────────────
// When a broadcastSend job exhausts attempts, BullMQ marks the job 'failed'
// but the BroadcastDelivery row is still 'pending'. This QueueEvents listener
// flips the row to 'failed' so the inbox reflects reality.
const sendQueue = new Queue(QUEUE_BROADCAST_SEND, { connection: redisConnection });
const sendEvents = new QueueEvents(QUEUE_BROADCAST_SEND, { connection: redisConnection });
sendEvents.on('failed', async ({ jobId, failedReason }) => {
  if (!jobId) return;
  const job = await sendQueue.getJob(jobId);
  if (!job) return;
  if ((job.attemptsMade ?? 0) < (job.opts.attempts ?? 1)) return; // still retrying
  const data = job.data as { broadcastDeliveryId?: string };
  if (!data.broadcastDeliveryId) return;
  try {
    const id = BigInt(data.broadcastDeliveryId);
    const bd = await prisma.broadcastDelivery.update({
      where: { id },
      data: { status: 'failed', lastError: failedReason?.slice(0, 4000) ?? null },
    });
    await prisma.broadcast.update({
      where: { id: bd.broadcastId },
      data: { failedCount: { increment: 1 } },
    });
  } catch (err) {
    logger.error({ err, jobId }, 'failed to mark broadcast delivery as failed');
  }
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down workers');
  await Promise.allSettled(workers.map((w) => w.close()));
  await sendEvents.close().catch(() => undefined);
  await sendQueue.close().catch(() => undefined);
  await waitSweepQueue.close().catch(() => undefined);
  await redisConnection.quit().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection');
});
