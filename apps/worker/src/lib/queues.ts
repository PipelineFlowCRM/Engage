// Producer queues used from worker code paths. Worker workers consume
// queues via Worker(), but some workers also produce — e.g. broadcastSend
// and sendTemplate enqueue CRM activity pushes after a successful send.

import { Queue } from 'bullmq';
import {
  QUEUE_BROADCAST_BATCH,
  QUEUE_BROADCAST_SEND,
  QUEUE_CRM_ACTIVITY_PUSH,
  QUEUE_JOURNEY_TICK,
  QUEUE_JOURNEY_TRIGGER,
  type BroadcastBatchJobData,
  type BroadcastSendJobData,
  type CrmActivityPushJobData,
  type JourneyTickJobData,
  type JourneyTriggerJobData,
} from '@pipelineflow-engagement/shared';
import { redisConnection } from './redis.js';
import { env } from '../env.js';

export const crmActivityPushQueue = new Queue<CrmActivityPushJobData>(
  QUEUE_CRM_ACTIVITY_PUSH,
  { connection: redisConnection },
);

export const journeyTickQueue = new Queue<JourneyTickJobData>(
  QUEUE_JOURNEY_TICK,
  { connection: redisConnection },
);

export const journeyTriggerQueue = new Queue<JourneyTriggerJobData>(
  QUEUE_JOURNEY_TRIGGER,
  { connection: redisConnection },
);

export const broadcastBatchQueue = new Queue<BroadcastBatchJobData>(
  QUEUE_BROADCAST_BATCH,
  { connection: redisConnection },
);
export const broadcastSendQueue = new Queue<BroadcastSendJobData>(
  QUEUE_BROADCAST_SEND,
  { connection: redisConnection },
);

// Single close-everything entry point so the worker shutdown path can
// reap connections cleanly.
export async function closeProducerQueues(): Promise<void> {
  await Promise.allSettled([
    crmActivityPushQueue.close(),
    journeyTickQueue.close(),
    journeyTriggerQueue.close(),
    broadcastBatchQueue.close(),
    broadcastSendQueue.close(),
  ]);
}

// Fire-and-forget helper. CRM bridge is optional — we silently no-op when
// not configured so worker code paths don't have to branch.
export async function enqueueCrmActivityPush(data: CrmActivityPushJobData): Promise<void> {
  if (!env.CRM_BASE_URL) return;
  await crmActivityPushQueue.add(QUEUE_CRM_ACTIVITY_PUSH, data).catch(() => undefined);
}
