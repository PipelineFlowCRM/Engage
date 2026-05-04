// Stuck-run sweep. Recovers JourneyRun rows that ended up in 'running'
// state without a pending tick scheduled. Causes:
//   - Worker crashed between `journeyRun.create` and `tickQueue.add` in
//     journeyTrigger (run row exists, no tick).
//   - Redis got flushed and lost a delayed tick.
//   - Manual operator intervention left a run dangling.
//
// We look for runs where status='running' AND scheduledFor IS NULL AND
// pendingJobId IS NULL — those are the unambiguously orphaned ones.
// Runs in 'waiting' state are handled by the wait sweep + signal
// resume path.

import { QUEUE_JOURNEY_TICK } from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { journeyTickQueue as tickQueue } from '../lib/queues.js';

const SWEEP_LIMIT = 200;
// Only re-enqueue runs that have been orphaned for at least this long —
// prevents fighting against an in-flight tick that is mid-work but
// hasn't yet committed scheduledFor.
const ORPHAN_GRACE_MS = 60_000;

export async function processJourneyStuckRunSweep(): Promise<void> {
  const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);
  const orphans = await prisma.journeyRun.findMany({
    where: {
      status: 'running',
      scheduledFor: null,
      pendingJobId: null,
      // Avoid newly-created rows; the tick enqueue might be in flight.
      startedAt: { lt: cutoff },
    },
    select: {
      id: true,
      currentNodeId: true,
      versionId: true,
    },
    take: SWEEP_LIMIT,
  });
  if (orphans.length === 0) return;
  logger.info({ count: orphans.length }, 'journey-stuck-run-sweep: re-enqueueing orphans');
  for (const o of orphans) {
    await tickQueue
      .add(
        QUEUE_JOURNEY_TICK,
        {
          runId: o.id.toString(),
          expectedNodeId: o.currentNodeId,
          expectedVersionId: o.versionId,
        },
        { jobId: `tick:${o.id.toString()}:${o.currentNodeId}:recovery` },
      )
      .catch((err) => logger.warn({ err, runId: o.id.toString() }, 'failed to re-enqueue orphan tick'));
  }
}
