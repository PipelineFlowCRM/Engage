// Broadcast launch worker. Snapshots the audience into BroadcastDelivery rows
// (filtering out unsubscribed/suppressed at snapshot time), then fans out
// batch jobs to drive the per-send queue.

import type { Job } from 'bullmq';
import type { BroadcastLaunchJobData } from '@pipelineflow-engagement/shared';
import { Queue } from 'bullmq';
import { QUEUE_BROADCAST_BATCH } from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { redisConnection } from '../lib/redis.js';

const broadcastBatchQueue = new Queue(QUEUE_BROADCAST_BATCH, { connection: redisConnection });
const BATCH_SIZE = 100;

export async function processBroadcastLaunch(job: Job<BroadcastLaunchJobData>) {
  const { broadcastId } = job.data;
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
    include: { template: true },
  });
  if (!broadcast) {
    logger.warn({ broadcastId }, 'broadcast launch: row missing');
    return;
  }
  if (broadcast.status !== 'snapshotting' && broadcast.status !== 'running') {
    logger.info({ broadcastId, status: broadcast.status }, 'broadcast launch: not in launchable state, skipping');
    return;
  }

  const subscriptionGroupId = broadcast.template.subscriptionGroupId;
  if (subscriptionGroupId == null) {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: 'failed', errorMessage: 'Template has no subscription group', completedAt: new Date() },
    });
    return;
  }

  // Snapshot. Skip subscribers with no email, hard-suppressed, or unsubscribed
  // from this group.
  // Insert ON CONFLICT DO NOTHING so a re-run of launch (manual + cron etc.)
  // is idempotent against the existing snapshot.
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "BroadcastDelivery" ("broadcastId", "subscriberId", "status", "skipReason")
    SELECT
      $1::int,
      sub.id,
      CASE
        WHEN sub.email IS NULL OR sub.email = '' THEN 'skipped'
        WHEN supp.email IS NOT NULL THEN 'skipped'
        WHEN ss."status" = 'unsubscribed' THEN 'skipped'
        ELSE 'pending'
      END AS status,
      CASE
        WHEN sub.email IS NULL OR sub.email = '' THEN 'no_email'
        WHEN supp.email IS NOT NULL THEN 'suppressed'
        WHEN ss."status" = 'unsubscribed' THEN 'unsubscribed'
        ELSE NULL
      END AS skip_reason
    FROM "AudienceMember" am
    JOIN "Subscriber" sub ON sub.id = am."subscriberId"
    LEFT JOIN "Suppression" supp ON supp.email = LOWER(sub.email)
    LEFT JOIN "SubscriptionState" ss
      ON ss."subscriberId" = sub.id AND ss."groupId" = $2::int
    WHERE am."audienceId" = $3::int
    ON CONFLICT ("broadcastId", "subscriberId") DO NOTHING
    `,
    broadcastId, subscriptionGroupId, broadcast.audienceId,
  );

  // Aggregate counts.
  const counts = await prisma.broadcastDelivery.groupBy({
    by: ['status'],
    where: { broadcastId },
    _count: { _all: true },
  });
  const total = counts.reduce((acc, c) => acc + (c._count._all ?? 0), 0);
  const pending = counts.find((c) => c.status === 'pending')?._count._all ?? 0;
  const skipped = counts.find((c) => c.status === 'skipped')?._count._all ?? 0;

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: {
      status: pending > 0 ? 'running' : 'completed',
      snapshotTakenAt: new Date(),
      totalRecipients: total,
      skippedCount: skipped,
      ...(pending === 0 ? { completedAt: new Date() } : {}),
    },
  });

  if (pending === 0) return;

  // Fan out batch jobs.
  // Use cursor-style offsetId so a giant audience doesn't OFFSET-scan.
  const pendingRows = await prisma.broadcastDelivery.findMany({
    where: { broadcastId, status: 'pending' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (let i = 0; i < pendingRows.length; i += BATCH_SIZE) {
    const slice = pendingRows.slice(i, i + BATCH_SIZE);
    if (!slice.length) continue;
    const offsetId = (slice[0]!.id - 1n).toString();
    await broadcastBatchQueue.add(QUEUE_BROADCAST_BATCH, {
      broadcastId,
      offsetId,
      limit: slice.length,
    });
  }
}
