// Wait sweep. Runs every 30s. Finds JourneyWait rows whose expiresAt has
// passed and fires the WaitFor node's timeoutNext branch (or exits the
// run if no timeoutNext is set). Each timeout is processed under the
// per-run advisory lock so we serialise against any concurrent
// journeyTick or journeyTrigger transition for the same run.

import { QUEUE_JOURNEY_TICK } from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { LOCK_NS, withAdvisoryLock } from '../lib/locks.js';
import { lookupNode, parseDefinition } from '../lib/journey.js';
import { journeyTickQueue as tickQueue } from '../lib/queues.js';

const SWEEP_LIMIT = 500;

export async function processJourneyWaitSweep(): Promise<void> {
  // Initial scan unlocked — we re-validate under the per-run lock below.
  const expired = await prisma.journeyWait.findMany({
    where: { expiresAt: { lt: new Date() } },
    orderBy: { expiresAt: 'asc' },
    take: SWEEP_LIMIT,
    select: { id: true, runId: true },
  });
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
  await withAdvisoryLock(LOCK_NS.journeyRun, runId.toString(), async (tx) => {
    const wait = await tx.journeyWait.findUnique({ where: { id: waitId } });
    // Already resolved — nothing to do.
    if (!wait) return;
    if (wait.expiresAt > new Date()) {
      // Race with a producer that extended expiresAt. Safe no-op.
      return;
    }

    const run = await tx.journeyRun.findUnique({
      where: { id: runId },
      include: { version: true },
    });
    if (!run || run.status !== 'waiting') {
      await tx.journeyWait.delete({ where: { id: waitId } });
      return;
    }
    const def = parseDefinition(run.version.definition);
    const node = lookupNode(def, run.currentNodeId);
    if (node.type !== 'WaitFor') {
      logger.warn(
        { runId: runId.toString(), nodeId: run.currentNodeId },
        'journey-wait-sweep: wait points at non-WaitFor node; cleaning up',
      );
      await tx.journeyWait.delete({ where: { id: waitId } });
      return;
    }

    if (!node.timeoutNext) {
      await tx.journeyRunStep.create({
        data: {
          runId,
          nodeId: run.currentNodeId,
          nodeType: 'WaitFor',
          outcome: 'timed_out',
          meta: { cause: 'timeout', next: 'exit' },
        },
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
      return;
    }

    await tx.journeyRunStep.create({
      data: {
        runId,
        nodeId: run.currentNodeId,
        nodeType: 'WaitFor',
        outcome: 'timed_out',
        meta: { cause: 'timeout', next: node.timeoutNext },
      },
    });
    await tx.journeyWait.delete({ where: { id: waitId } });
    await tx.journeyRun.update({
      where: { id: runId },
      data: {
        status: 'running',
        currentNodeId: node.timeoutNext,
        scheduledFor: null,
      },
    });
    await tickQueue.add(
      QUEUE_JOURNEY_TICK,
      {
        runId: runId.toString(),
        expectedNodeId: node.timeoutNext,
        expectedVersionId: run.versionId,
      },
      { jobId: `tick__${runId.toString()}__${node.timeoutNext}__timeout` },
    );
  });
}
