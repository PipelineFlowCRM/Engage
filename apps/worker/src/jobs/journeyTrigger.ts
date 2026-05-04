// Journey trigger. Inputs come from two places:
//   - Audience compute worker, after computing entered/exited diffs
//     (kind='audience-enter').
//   - Events ingest worker, after committing an event row (kind='event').
//
// For each, we find published Journeys whose entry node matches the
// trigger, then create JourneyRun rows + enqueue ticks. The
// (journeyId, subscriberId, versionId) UNIQUE on JourneyRun absorbs
// duplicate triggers — at most one active run per tuple.

import type { Job } from 'bullmq';
import {
  QUEUE_JOURNEY_TICK,
  type JourneyTriggerJobData,
} from '@pipelineflow-engagement/shared';
import { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { redisConnection } from '../lib/redis.js';
import { lookupNode, parseDefinition, recordStep } from '../lib/journey.js';

const tickQueue = new Queue(QUEUE_JOURNEY_TICK, { connection: redisConnection });

export async function processJourneyTrigger(job: Job<JourneyTriggerJobData>): Promise<void> {
  const data = job.data;
  const subscriberId = BigInt(data.subscriberId);
  const signalKey = data.kind === 'event' ? data.event : String(data.audienceId);

  // 1) Resume any matching JourneyWait rows for this subscriber (signal
  // arrived). All three trigger kinds can wake a wait.
  await resumeWaitsForSignal(data.kind, signalKey, subscriberId);

  // 2) Audience-exit is wait-only — it never starts a new run.
  if (data.kind === 'audience-exit') return;

  // 3) Start new runs for journeys whose entry node matches.
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
      matches = entry.event === data.event;
      // (Property predicate evaluation deferred — Phase 2 honours event
      // name only. The shared schema accepts predicates so the UI can ship
      // them; the worker will read + filter once a small property-predicate
      // evaluator lands.)
    }
    if (!matches) continue;

    try {
      // The entry node points to entry.next. We start the run there.
      const startAt = (entry as { next: string }).next;
      const run = await prisma.journeyRun.create({
        data: {
          journeyId: j.id,
          versionId: j.currentVersionId!,
          subscriberId,
          status: 'running',
          currentNodeId: startAt,
        },
      });
      await prisma.$transaction(async (tx) => {
        await recordStep(tx, run.id, definition.entry, entry.type, 'exited', {
          trigger: data.kind,
          ...(data.kind === 'event' ? { eventMessageId: data.eventMessageId } : {}),
        });
      });
      await tickQueue.add(
        QUEUE_JOURNEY_TICK,
        {
          runId: run.id.toString(),
          expectedNodeId: startAt,
          expectedVersionId: j.currentVersionId!,
        },
        { jobId: `tick:${run.id.toString()}:${startAt}:initial` },
      );
      logger.info(
        { runId: run.id.toString(), journeyId: j.id, subscriberId: data.subscriberId },
        'journey-trigger: started run',
      );
    } catch (err) {
      // Most likely cause: unique-conflict on (journeyId, subscriberId, versionId).
      // That's expected — duplicate trigger for an already-running journey.
      if (
        err instanceof Error &&
        (err as Error & { code?: string }).code === 'P2002'
      ) {
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

// Helper used by the events ingest worker AND the audience compute worker
// to also match WaitFor signals on running journeys (separate from the
// entry-node match above). Signature matches what those callers need:
// given a signal, find JourneyWait rows + enqueue resume ticks.
export async function resumeWaitsForSignal(
  signalType: 'event' | 'audience-enter' | 'audience-exit',
  signalKey: string,
  subscriberId: bigint,
): Promise<void> {
  // Match by (signalType, signalKey) AND the subscriber on the parent run.
  // The JourneyWait→JourneyRun→subscriberId join keeps it focused.
  const waits = await prisma.journeyWait.findMany({
    where: {
      signalType,
      signalKey,
      run: { subscriberId, status: 'waiting' },
    },
    include: { run: { include: { version: true } } },
  });
  for (const w of waits) {
    const def = parseDefinition(w.run.version.definition);
    const node = lookupNode(def, w.run.currentNodeId);
    if (node.type !== 'WaitFor') {
      logger.warn(
        { runId: w.runId.toString(), nodeId: w.run.currentNodeId, nodeType: node.type },
        'journey-resume: wait points at non-WaitFor node, deleting',
      );
      await prisma.journeyWait.delete({ where: { id: w.id } });
      continue;
    }
    // Property-predicate evaluation deferred — match on signal key alone for now.
    await prisma.$transaction(async (tx) => {
      await recordStep(tx, w.runId, w.run.currentNodeId, 'WaitFor', 'exited', {
        signalType,
        signalKey,
        cause: 'signal-arrived',
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
    });
    await tickQueue.add(
      QUEUE_JOURNEY_TICK,
      {
        runId: w.runId.toString(),
        expectedNodeId: node.next,
        expectedVersionId: w.run.versionId,
      },
      { jobId: `tick:${w.runId.toString()}:${node.next}:resume` },
    );
  }
}

// Cast to void-using `Prisma.InputJsonValue` import for the predicate field
// later when we land predicate evaluation. Imported for forward-compat.
const _unused: Prisma.InputJsonValue | null = null;
void _unused;
