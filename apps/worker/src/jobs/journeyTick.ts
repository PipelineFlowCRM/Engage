// Journey tick. Advances one JourneyRun by one node — or hot-loops a few
// non-delayed nodes within TICK_NODE_BUDGET.
//
// At-least-once protection. BullMQ may deliver a tick more than once
// (worker restart mid-process; manual retry from Bull Board). Two guards:
//   1. Job-data carries (expectedNodeId, expectedVersionId). The runner
//      bails at the top if the run row's currentNodeId / versionId don't
//      match — a duplicate tick for a node we've already advanced past
//      becomes a no-op.
//   2. Send-side: Delivery.providerMessageId is UNIQUE, so even if the
//      runner did somehow duplicate a Message step, SES wouldn't double-send
//      (the second insert would fail and the runner would mark failed).
//      Plus the broader sendTemplate path is wrapped in delivery-row
//      transactions.
//
// Row-level locking via SELECT … FOR UPDATE SKIP LOCKED. Two workers
// can't both process the same run; the loser exits cleanly.

import type { Job } from 'bullmq';
import type { JourneyTickJobData, JourneyNode } from '@pipelineflow-engagement/shared';
import { Queue } from 'bullmq';
import { QUEUE_JOURNEY_TICK } from '@pipelineflow-engagement/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { redisConnection } from '../lib/redis.js';
import {
  TICK_NODE_BUDGET,
  computeDelayMs,
  isInAudience,
  lookupNode,
  parseDefinition,
  recordStep,
} from '../lib/journey.js';
import { sendTemplate } from '../lib/messaging.js';

const tickQueue = new Queue<JourneyTickJobData>(QUEUE_JOURNEY_TICK, { connection: redisConnection });

export async function processJourneyTick(job: Job<JourneyTickJobData>): Promise<void> {
  const { runId, expectedNodeId, expectedVersionId } = job.data;
  const id = BigInt(runId);

  // Take row-level lock. If another worker has it, we exit; their tick is
  // the authoritative one and BullMQ will retry only if they fail.
  const locked = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM "JourneyRun" WHERE id = ${id} FOR UPDATE SKIP LOCKED LIMIT 1
  `;
  if (locked.length === 0) {
    logger.debug({ runId }, 'journey-tick: another worker holds the row, skipping');
    return;
  }

  const run = await prisma.journeyRun.findUnique({
    where: { id },
    include: { version: true, journey: true, subscriber: true },
  });
  if (!run) return; // run was deleted; nothing to do
  if (run.status !== 'running' && run.status !== 'waiting') return;
  if (run.journey.status === 'archived') {
    await terminateRun(id, 'failed', 'journey-archived');
    return;
  }

  // Idempotency guards
  if (run.currentNodeId !== expectedNodeId) {
    logger.debug(
      { runId, expectedNodeId, actualNodeId: run.currentNodeId },
      'journey-tick: stale tick (currentNodeId mismatch), skipping',
    );
    return;
  }
  if (run.versionId !== expectedVersionId) {
    logger.debug(
      { runId, expectedVersionId, actualVersionId: run.versionId },
      'journey-tick: stale tick (versionId mismatch), skipping',
    );
    return;
  }

  const definition = parseDefinition(run.version.definition);
  let currentNodeId = run.currentNodeId;
  let context = (run.context as Record<string, unknown>) ?? {};

  for (let i = 0; i < TICK_NODE_BUDGET; i += 1) {
    const node = lookupNode(definition, currentNodeId);
    const result = await executeNode({
      run: { id, subscriber: run.subscriber, journeyId: run.journeyId, versionId: run.versionId },
      node,
      currentNodeId,
      context,
    });

    if (result.kind === 'wait') {
      // executeNode already inserted JourneyWait + flipped state
      return;
    }
    if (result.kind === 'exit') {
      await terminateRun(id, 'completed', result.reason ?? null);
      return;
    }
    // continue
    if (result.contextPatch) {
      context = { ...context, ...result.contextPatch };
    }
    if (result.scheduledForMs && result.scheduledForMs > 0) {
      // Delayed advance — persist new currentNodeId, schedule a future tick.
      const next = result.nextNodeId!;
      const fireAt = new Date(Date.now() + result.scheduledForMs);
      const newJob = await tickQueue.add(
        QUEUE_JOURNEY_TICK,
        {
          runId,
          expectedNodeId: next,
          expectedVersionId: run.versionId,
        },
        {
          delay: result.scheduledForMs,
          // Stable jobId so a duplicate enqueue (e.g. manual retry) collapses.
          jobId: `tick:${runId}:${next}:${fireAt.getTime()}`,
        },
      );
      await prisma.journeyRun.update({
        where: { id },
        data: {
          currentNodeId: next,
          context: context as Prisma.InputJsonValue,
          scheduledFor: fireAt,
          pendingJobId: String(newJob.id),
          status: 'running',
        },
      });
      return;
    }
    // No delay — loop within this same tick.
    currentNodeId = result.nextNodeId!;
  }

  // We exhausted TICK_NODE_BUDGET. Persist where we are and re-enqueue
  // immediately so another tick picks up. Better than blowing the budget.
  logger.warn({ runId, currentNodeId }, 'journey-tick: budget hit, re-enqueueing');
  const newJob = await tickQueue.add(QUEUE_JOURNEY_TICK, {
    runId,
    expectedNodeId: currentNodeId,
    expectedVersionId: run.versionId,
  });
  await prisma.journeyRun.update({
    where: { id },
    data: {
      currentNodeId,
      context: context as Prisma.InputJsonValue,
      pendingJobId: String(newJob.id),
    },
  });
}

// Result of executing one node. The runner uses this to decide whether to
// loop, schedule a delayed tick, or stop.
type StepKind =
  | { kind: 'continue'; nextNodeId: string; scheduledForMs?: number; contextPatch?: Record<string, unknown> }
  | { kind: 'wait' }
  | { kind: 'exit'; reason?: string };

interface ExecuteCtx {
  run: { id: bigint; subscriber: import('@prisma/client').Subscriber; journeyId: number; versionId: number };
  node: JourneyNode;
  currentNodeId: string;
  context: Record<string, unknown>;
}

async function executeNode(ctx: ExecuteCtx): Promise<StepKind> {
  const { node, run, currentNodeId } = ctx;

  switch (node.type) {
    case 'EventEntry':
    case 'SegmentEntry': {
      // Entry nodes are inert when run by the tick — the trigger spawned
      // the run, and run.currentNodeId is already set to entry.next when
      // the run is created. If we ever arrive here, just advance.
      await prisma.$transaction(async (tx) => {
        await recordStep(tx, run.id, currentNodeId, node.type, 'exited');
      });
      return { kind: 'continue', nextNodeId: node.next };
    }

    case 'Delay': {
      // Delay is a virtual "advance, then wait until scheduledFor". The
      // first time we hit the Delay node we record `entered` and schedule
      // the next tick; the second time (after wakeup) we record `exited`
      // and continue. Distinguish by checking if we're being entered fresh
      // (run row's currentNodeId is this delay) or post-wakeup (we
      // shouldn't be — runner should have already advanced past).
      // Implementation: schedule the next tick and advance currentNodeId
      // straight to next; when the next tick fires, currentNodeId will be
      // the Delay's `next`, not this Delay. So the first time we touch
      // Delay we just compute the wakeup and continue with scheduledForMs.
      const ms = computeDelayMs(node, (run.subscriber.traits as Record<string, unknown>) ?? {});
      await prisma.$transaction(async (tx) => {
        await recordStep(tx, run.id, currentNodeId, 'Delay', 'entered', { ms });
      });
      return { kind: 'continue', nextNodeId: node.next, scheduledForMs: ms };
    }

    case 'Message': {
      const outcome = await sendTemplate({
        templateId: node.templateId,
        subscriber: run.subscriber,
        journeyRunId: run.id,
      });
      await prisma.$transaction(async (tx) => {
        await recordStep(
          tx, run.id, currentNodeId, 'Message',
          outcome.status === 'sent' ? 'exited'
            : outcome.status === 'failed' ? 'errored'
            : 'skipped',
          {
            outcome: outcome.status,
            ...(outcome.status === 'sent' ? { deliveryId: outcome.deliveryId.toString() } : {}),
            ...(outcome.status === 'skipped' ? { reason: outcome.reason } : {}),
            ...(outcome.status === 'failed' ? { error: outcome.error.slice(0, 1000) } : {}),
          },
        );
      });
      // Always advance — a skipped/failed message shouldn't block the
      // journey. Operators can spot failures via the deliveries inbox.
      return { kind: 'continue', nextNodeId: node.next };
    }

    case 'WaitFor': {
      // Insert JourneyWait, flip run to 'waiting'. Resume happens via the
      // events ingest worker (signalType='event'), the audience compute
      // worker (signalType='audience-enter|exit'), or the wait sweep
      // (timeout). All three call resumeRun() (in journeyResume.ts) which
      // re-enqueues a tick targeting node.next or node.timeoutNext.
      const expiresAt = new Date(Date.now() + node.timeoutSeconds * 1_000);
      const signalType = node.signal.kind;
      const signalKey =
        node.signal.kind === 'event'
          ? node.signal.event
          : String(node.signal.audienceId);
      const predicate =
        node.signal.kind === 'event' && node.signal.properties
          ? (node.signal.properties as unknown as import('@prisma/client').Prisma.InputJsonValue)
          : undefined;

      await prisma.$transaction(async (tx) => {
        await recordStep(tx, run.id, currentNodeId, 'WaitFor', 'entered', {
          signalType,
          signalKey,
          expiresAt: expiresAt.toISOString(),
        });
        // Replace any pre-existing wait for this run (rare — only if the
        // run somehow re-entered the same WaitFor; the @unique on runId
        // means we have to upsert).
        await tx.journeyWait.upsert({
          where: { runId: run.id },
          create: {
            runId: run.id,
            signalType,
            signalKey,
            ...(predicate !== undefined ? { predicate } : {}),
            expiresAt,
          },
          update: {
            signalType,
            signalKey,
            // Prisma needs its JsonNull sentinel (not literal null) to clear
            // a nullable Json column.
            predicate: predicate !== undefined ? predicate : Prisma.JsonNull,
            expiresAt,
          },
        });
        await tx.journeyRun.update({
          where: { id: run.id },
          data: { status: 'waiting', scheduledFor: null, pendingJobId: null },
        });
      });
      return { kind: 'wait' };
    }

    case 'SegmentSplit': {
      const member = await isInAudience(prisma, node.audienceId, run.subscriber.id);
      const branch = member ? node.trueNext : node.falseNext;
      await prisma.$transaction(async (tx) => {
        await recordStep(tx, run.id, currentNodeId, 'SegmentSplit', 'exited', {
          audienceId: node.audienceId,
          branch: member ? 'true' : 'false',
        });
      });
      return { kind: 'continue', nextNodeId: branch };
    }

    case 'Exit': {
      await prisma.$transaction(async (tx) => {
        await recordStep(tx, run.id, currentNodeId, 'Exit', 'exited', {
          ...(node.reason ? { reason: node.reason } : {}),
        });
      });
      return { kind: 'exit', reason: node.reason };
    }
  }
}

async function terminateRun(id: bigint, status: 'completed' | 'failed', exitReason: string | null) {
  await prisma.journeyRun.update({
    where: { id },
    data: {
      status,
      completedAt: new Date(),
      ...(exitReason ? { exitReason } : {}),
      pendingJobId: null,
      scheduledFor: null,
    },
  });
}
