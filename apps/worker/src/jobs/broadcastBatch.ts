// Broadcast batch worker. Picks up a window of pending BroadcastDelivery
// rows and enqueues a per-send job for each.

import type { Job } from 'bullmq';
import type { BroadcastBatchJobData } from '@pipelineflow-engagement/shared';
import { Queue } from 'bullmq';
import { QUEUE_BROADCAST_SEND } from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { redisConnection } from '../lib/redis.js';

const broadcastSendQueue = new Queue(QUEUE_BROADCAST_SEND, { connection: redisConnection });

export async function processBroadcastBatch(job: Job<BroadcastBatchJobData>) {
  const { broadcastId, offsetId, limit } = job.data;
  const cursor = BigInt(offsetId);

  // Fetch the next `limit` pending rows after `cursor`. SKIP LOCKED so two
  // workers running this batch in parallel can't double-send.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
    `
    SELECT id FROM "BroadcastDelivery"
    WHERE "broadcastId" = $1
      AND "status" = 'pending'
      AND id > $2
    ORDER BY id
    LIMIT $3
    FOR UPDATE SKIP LOCKED
    `,
    broadcastId, cursor, limit,
  );

  // Honor pause: if the broadcast got paused while this batch was queued,
  // exit without enqueuing further sends.
  const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
  if (!broadcast || broadcast.status !== 'running') return;

  for (const r of rows) {
    await broadcastSendQueue.add(QUEUE_BROADCAST_SEND, { broadcastDeliveryId: r.id.toString() });
  }
}
