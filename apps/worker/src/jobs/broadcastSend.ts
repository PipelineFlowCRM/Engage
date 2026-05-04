// Per-send worker. Delegates the render+SES+Delivery pipeline to the
// shared sendTemplate helper so journeys and broadcasts go through the
// same idempotent path. The job's responsibility is now just:
//   1. Load BroadcastDelivery + verify it's still 'pending'.
//   2. Load Subscriber.
//   3. Call sendTemplate with idempotencyKey = "bd:<id>".
//   4. Translate the outcome into BroadcastDelivery status updates +
//      Broadcast counters.

import type { Job } from 'bullmq';
import type { BroadcastSendJobData } from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { sendTemplate } from '../lib/messaging.js';

export async function processBroadcastSend(job: Job<BroadcastSendJobData>) {
  const id = BigInt(job.data.broadcastDeliveryId);

  const bd = await prisma.broadcastDelivery.findUnique({
    where: { id },
    include: { broadcast: { include: { template: true } } },
  });
  if (!bd) {
    logger.warn({ id: id.toString() }, 'broadcast send: row missing');
    return;
  }
  if (bd.status !== 'pending') {
    logger.debug({ id: id.toString(), status: bd.status }, 'broadcast send: row not pending');
    return;
  }
  if (bd.broadcast.status === 'paused' || bd.broadcast.status === 'cancelled') {
    return;
  }

  const subscriber = await prisma.subscriber.findUnique({ where: { id: bd.subscriberId } });
  if (!subscriber) {
    await markSkipped(bd.broadcastId, id, 'no_email');
    return;
  }

  const outcome = await sendTemplate({
    templateId: bd.broadcast.templateId,
    subscriber,
    broadcastId: bd.broadcastId,
    idempotencyKey: `bd:${id.toString()}`,
  });

  if (outcome.status === 'sent') {
    await prisma.$transaction([
      prisma.broadcastDelivery.update({
        where: { id },
        data: { status: 'sent', deliveryId: outcome.deliveryId },
      }),
      prisma.broadcast.update({
        where: { id: bd.broadcastId },
        data: { sentCount: { increment: 1 } },
      }),
    ]);
  } else if (outcome.status === 'skipped') {
    await markSkipped(bd.broadcastId, id, outcome.reason);
  } else if (outcome.status === 'failed') {
    // Keep BroadcastDelivery as 'pending' so BullMQ can retry. Per-send
    // BullMQ attempts budget is in queue config; once exhausted, the
    // QueueEvents listener in worker/src/index.ts flips the row to
    // 'failed'.
    await prisma.broadcastDelivery.update({
      where: { id },
      data: {
        attemptCount: { increment: 1 },
        lastError: outcome.error.slice(0, 4000),
        deliveryId: outcome.deliveryId,
      },
    });
    throw new Error(outcome.error);
  } else {
    // 'inflight' — previous attempt's outcome is unknown. Don't double-send.
    // Mark as failed so the operator can investigate manually; the
    // 'inflight' Delivery row remains as evidence.
    await prisma.$transaction([
      prisma.broadcastDelivery.update({
        where: { id },
        data: {
          status: 'failed',
          deliveryId: outcome.deliveryId,
          lastError: 'Previous attempt outcome unreconciled — refusing to retry',
        },
      }),
      prisma.broadcast.update({
        where: { id: bd.broadcastId },
        data: { failedCount: { increment: 1 } },
      }),
    ]);
    return;
  }

  // Check if this was the last pending row for this broadcast — flip to completed.
  const stillPending = await prisma.broadcastDelivery.count({
    where: { broadcastId: bd.broadcastId, status: 'pending' },
  });
  if (stillPending === 0) {
    await prisma.broadcast.updateMany({
      where: { id: bd.broadcastId, status: 'running' },
      data: { status: 'completed', completedAt: new Date() },
    });
  }
}

async function markSkipped(broadcastId: number, id: bigint, reason: string) {
  await prisma.$transaction([
    prisma.broadcastDelivery.update({
      where: { id },
      data: { status: 'skipped', skipReason: reason },
    }),
    prisma.broadcast.update({
      where: { id: broadcastId },
      data: { skippedCount: { increment: 1 } },
    }),
  ]);
}
