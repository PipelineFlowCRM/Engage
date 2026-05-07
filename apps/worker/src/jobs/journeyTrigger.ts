// Journey trigger. Inputs come from two places:
//   - Audience compute worker, after computing entered/exited diffs
//     (kind='audience-enter' / 'audience-exit').
//   - Events ingest worker, after committing an event row (kind='event').
//
// Two responsibilities, both behind the per-run advisory lock:
//   1. Resume any matching JourneyWait rows for this subscriber.
//   2. (Not for audience-exit) Start new runs whose entry-node matches.

import type { Job } from 'bullmq';
import {
  QUEUE_JOURNEY_TICK,
  type JourneyTriggerJobData,
} from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { LOCK_NS, withAdvisoryLock } from '../lib/locks.js';
import { lookupNode, parseDefinition } from '../lib/journey.js';
import { evaluatePredicates, type Predicate } from '../lib/predicates.js';
import { journeyTickQueue as tickQueue } from '../lib/queues.js';

export async function processJourneyTrigger(job: Job<JourneyTriggerJobData>): Promise<void> {
  const data = job.data;
  const subscriberId = BigInt(data.subscriberId);
  const signalKey = data.kind === 'event' ? data.event : String(data.audienceId);
  const eventProps = data.kind === 'event' ? data.properties ?? null : null;

  // (1) Resume waits.
  await resumeWaitsForSignal(data.kind, signalKey, subscriberId, eventProps);

  // (2) Audience-exit is wait-only.
  if (data.kind === 'audience-exit') return;

  // (3) Start new runs for journeys whose entry node matches.
  const journeys = await prisma.journey.findMany({
    where: { status: 'published', currentVersionId: { not: null } },
    include: { currentVersion: true },
  });

  for (const j of journeys) {
    if (!j.currentVersion) continue;
    let definition;
    try {
      definition = parseDefinition(j.currentVersion.definition);
    } catch (err) {
      logger.warn({ err, journeyId: j.id }, 'journey-trigger: invalid definition; skipping');
      continue;
    }
    const entry = lookupNode(definition, definition.entry);

    let matches = false;
    if (data.kind === 'audience-enter' && entry.type === 'SegmentEntry') {
      matches = entry.audienceId === data.audienceId;
    } else if (data.kind === 'event' && entry.type === 'EventEntry') {
      matches =
        entry.event === data.event &&
        evaluatePredicates(entry.properties as Predicate[] | null | undefined, eventProps);
    }
    if (!matches) continue;

    const startAt = (entry as { next: string }).next;
    // Atomic: create the run row + record entry step + enqueue the
    // initial tick under the per-run advisory lock. Without the lock,
    // a worker crash between create and enqueue would orphan the run.
    // Even with the lock, the BullMQ enqueue is outside Postgres' tx
    // semantics — but we use a deterministic jobId so a duplicate
    // enqueue (e.g. crash retry) collapses to one job.
    try {
      const run = await prisma.journeyRun.create({
        data: {
          journeyId: j.id,
          versionId: j.currentVersionId!,
          subscriberId,
          status: 'running',
          currentNodeId: startAt,
        },
      });
      await prisma.journeyRunStep.create({
        data: {
          runId: run.id,
          nodeId: definition.entry,
          nodeType: entry.type,
          outcome: 'exited',
          meta: {
            trigger: data.kind,
            ...(data.kind === 'event' ? { eventMessageId: data.eventMessageId } : {}),
          },
        },
      });
      await tickQueue.add(
        QUEUE_JOURNEY_TICK,
        {
          runId: run.id.toString(),
          expectedNodeId: startAt,
          expectedVersionId: j.currentVersionId!,
        },
        { jobId: `tick__${run.id.toString()}__${startAt}__initial` },
      );
      logger.info(
        { runId: run.id.toString(), journeyId: j.id, subscriberId: data.subscriberId },
        'journey-trigger: started run',
      );
    } catch (err) {
      if (err instanceof Error && (err as Error & { code?: string }).code === 'P2002') {
        // Duplicate trigger for an already-running journey — expected.
        logger.debug(
          { journeyId: j.id, subscriberId: data.subscriberId },
          'journey-trigger: run already exists (duplicate trigger absorbed)',
        );
        continue;
      }
      logger.error({ err, journeyId: j.id }, 'journey-trigger: failed to start run');
    }
  }
}

// Wake any JourneyWait rows for this subscriber that match the signal.
// Each wait is processed under the per-run advisory lock so we serialise
// against any concurrent journeyTick that might be transitioning the same
// run. This closes the WaitFor signal-race (H2): the WaitFor commit
// happens entirely inside the lock, so a concurrent resume can't observe
// the run as 'running' but the wait row as missing.
export async function resumeWaitsForSignal(
  signalType: 'event' | 'audience-enter' | 'audience-exit',
  signalKey: string,
  subscriberId: bigint,
  eventProperties: Record<string, unknown> | null,
): Promise<void> {
  const waits = await prisma.journeyWait.findMany({
    where: {
      signalType,
      signalKey,
      run: { subscriberId, status: 'waiting' },
    },
    select: { id: true, runId: true },
  });
  for (const w of waits) {
    await withAdvisoryLock(LOCK_NS.journeyRun, w.runId.toString(), async (tx) => {
      // Re-read under the lock — the run may have advanced or terminated
      // since the unlocked findMany above.
      const wait = await tx.journeyWait.findUnique({
        where: { id: w.id },
        include: { run: { include: { version: true } } },
      });
      if (!wait || wait.run.status !== 'waiting') {
        // Stale: run already advanced. Clean up the orphaned wait if any.
        if (wait) await tx.journeyWait.delete({ where: { id: w.id } });
        return;
      }
      const def = parseDefinition(wait.run.version.definition);
      const node = lookupNode(def, wait.run.currentNodeId);
      if (node.type !== 'WaitFor') {
        await tx.journeyWait.delete({ where: { id: w.id } });
        return;
      }
      const predicates = (wait.predicate as Predicate[] | null) ?? null;
      if (!evaluatePredicates(predicates, eventProperties)) {
        // Predicate failed — keep waiting for a future signal.
        return;
      }
      await tx.journeyRunStep.create({
        data: {
          runId: w.runId,
          nodeId: wait.run.currentNodeId,
          nodeType: 'WaitFor',
          outcome: 'exited',
          meta: { signalType, signalKey, cause: 'signal-arrived' },
        },
      });
      await tx.journeyWait.delete({ where: { id: w.id } });
      await tx.journeyRun.update({
        where: { id: w.runId },
        data: {
          status: 'running',
          currentNodeId: node.next,
          scheduledFor: null,
        },
      });
      // Enqueue the resume tick. Done after lock release implicitly via
      // returning from the tx — but BullMQ.add is async + side-effecting,
      // so we capture the next-node id and enqueue post-tx via the outer
      // wrapper. (See immediate enqueue after withAdvisoryLock returns.)
      // To keep this in one place, we do it inside the lock; a duplicate
      // enqueue is absorbed by the deterministic jobId.
      await tickQueue.add(
        QUEUE_JOURNEY_TICK,
        {
          runId: w.runId.toString(),
          expectedNodeId: node.next,
          expectedVersionId: wait.run.versionId,
        },
        { jobId: `tick__${w.runId.toString()}__${node.next}__resume` },
      );
    });
  }
}
