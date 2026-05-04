// Wait sweep. Runs every 30s. Finds JourneyWait rows whose expiresAt has
// passed, fires the WaitFor node's timeoutNext branch (or exits the run if
// no timeoutNext is set). Locks the wait rows via SKIP LOCKED so a second
// worker doesn't double-fire.

import { Queue } from 'bullmq';
import { QUEUE_JOURNEY_TICK } from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { redisConnection } from '../lib/redis.js';
import { lookupNode, parseDefinition, recordStep } from '../lib/journey.js';

const tickQueue = new Queue(QUEUE_JOURNEY_TICK, { connection: redisConnection });

const SWEEP_LIMIT = 500;

export async function processJourneyWaitSweep(): Promise<void> {
  const expired = await prisma.$queryRaw<Array<{ id: bigint; runId: bigint }>>`
    SELECT id, "runId" FROM "JourneyWait"
    WHERE "expiresAt" < NOW()
    ORDER BY "expiresAt" ASC
    LIMIT ${SWEEP_LIMIT}
    FOR UPDATE SKIP LOCKED
  `;
  if (expired.length === 0) return;

  for (const w of expired) {
    try {
      await fireTimeout(w.runId, w.id);
    } catch (err) {
      logger.error(
        { err, runId: w.runId.toString(), waitId: w.id.toString() },
        'journey-wait-sweep: failed to fire timeout',
      );
    }
  }
}

async function fireTimeout(runId: bigint, waitId: bigint): Promise<void> {
  const run = await prisma.journeyRun.findUnique({
    where: { id: runId },
    include: { version: true },
  });
  if (!run || run.status !== 'waiting') {
    // Stale. Just clean up the wait.
    await prisma.journeyWait.delete({ where: { id: waitId } }).catch(() => undefined);
    return;
  }
  const def = parseDefinition(run.version.definition);
  const node = lookupNode(def, run.currentNodeId);
  if (node.type !== 'WaitFor') {
    logger.warn(
      { runId: runId.toString(), nodeId: run.currentNodeId },
      'journey-wait-sweep: wait points at non-WaitFor node; cleaning up',
    );
    await prisma.journeyWait.delete({ where: { id: waitId } });
    return;
  }

  if (!node.timeoutNext) {
    // No timeout branch — exit the run.
    await prisma.$transaction(async (tx) => {
      await recordStep(tx, runId, run.currentNodeId, 'WaitFor', 'timed_out', {
        cause: 'timeout',
        next: 'exit',
      });
      await tx.journeyWait.delete({ where: { id: waitId } });
      await tx.journeyRun.update({
        where: { id: runId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          exitReason: 'wait-timeout',
        },
      });
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await recordStep(tx, runId, run.currentNodeId, 'WaitFor', 'timed_out', {
      cause: 'timeout',
      next: node.timeoutNext!,
    });
    await tx.journeyWait.delete({ where: { id: waitId } });
    await tx.journeyRun.update({
      where: { id: runId },
      data: {
        status: 'running',
        currentNodeId: node.timeoutNext!,
        scheduledFor: null,
      },
    });
  });
  await tickQueue.add(
    QUEUE_JOURNEY_TICK,
    {
      runId: runId.toString(),
      expectedNodeId: node.timeoutNext!,
      expectedVersionId: run.versionId,
    },
    { jobId: `tick:${runId.toString()}:${node.timeoutNext!}:timeout` },
  );
}
