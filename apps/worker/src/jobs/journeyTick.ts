// Journey tick. Advances one JourneyRun by one node — or hot-loops a few
// non-delayed nodes within TICK_NODE_BUDGET.
//
// Concurrency model — three layers, each catches a different failure mode:
//
//   1. **Per-run advisory lock** (this file, withAdvisoryLock). Held for
//      the duration of the tick. Two concurrent ticks targeting the same
//      run serialize: the loser blocks until the winner commits, then
//      reads the post-state and (almost always) bails on the
//      expectedNodeId guard.
//
//   2. **Stable BullMQ jobIds** (caller-side). Tickers use deterministic
//      ids like `tick:<runId>:<nodeId>:<fireTime>` so BullMQ can't run
//      two simultaneous instances of the same logical step.
//
//   3. **Idempotency keys on Delivery** (lib/messaging.ts). Even if a
//      Message-node tick is replayed past both guards above, the
//      idempotency key on (runId, nodeId) blocks the second SES send.
//
// Together these prevent: duplicate sends, duplicate state advances,
// duplicate JourneyRunStep audit rows, and the WaitFor signal-race
// (since the resume worker also acquires the same lock).

import type { Job } from 'bullmq';
import type { JourneyNode, JourneyTickJobData } from '@pipelineflow-engagement/shared';
import { QUEUE_JOURNEY_TICK } from '@pipelineflow-engagement/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import {
  TICK_NODE_BUDGET,
  computeDelayMs,
  lookupNode,
  parseDefinition,
} from '../lib/journey.js';
import { evaluatePredicate } from '../lib/predicates.js';
import { LOCK_NS, withAdvisoryLock } from '../lib/locks.js';
import { sendTemplate } from '../lib/messaging.js';
import { journeyTickQueue as tickQueue } from '../lib/queues.js';

// Tick acquires the per-run lock + an open tx for the duration. Inside
// that tx we read+validate state, run the step (including the SES call
// for Message nodes — its idempotency key handles cross-tx atomicity),
// and persist the next state. Nested tx within sendTemplate runs as a
// savepoint inside the outer tx.
const TICK_TIMEOUT_MS = 60_000;

export async function processJourneyTick(job: Job<JourneyTickJobData>): Promise<void> {
  const { runId, expectedNodeId, expectedVersionId } = job.data;
  const id = BigInt(runId);

  const result = await withAdvisoryLock(
    LOCK_NS.journeyRun,
    runId,
    async (tx) => runTickInTx(tx, id, runId, expectedNodeId, expectedVersionId),
    { timeoutMs: TICK_TIMEOUT_MS },
  );

  if (result === null) {
    logger.debug({ runId }, 'journey-tick: another worker holds the lock, skipping');
  }
}

interface TickContext {
  tx: Prisma.TransactionClient;
  runId: string;          // wire-format (BigInt as string) for queue payloads
  runIdBigInt: bigint;
  expectedVersionId: number;
}

async function runTickInTx(
  tx: Prisma.TransactionClient,
  id: bigint,
  runId: string,
  expectedNodeId: string,
  expectedVersionId: number,
): Promise<void> {
  const run = await tx.journeyRun.findUnique({
    where: { id },
    include: { version: true, journey: true, subscriber: true },
  });
  if (!run) return;
  if (run.status !== 'running' && run.status !== 'waiting') return;
  if (run.journey.status === 'archived') {
    await terminateRunInTx(tx, id, 'failed', 'journey-archived');
    return;
  }
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
  const tickCtx: TickContext = { tx, runId, runIdBigInt: id, expectedVersionId };

  for (let i = 0; i < TICK_NODE_BUDGET; i += 1) {
    const node = lookupNode(definition, currentNodeId);
    const result = await executeNode(tickCtx, run.subscriber, node, currentNodeId);

    if (result.kind === 'wait') return;
    if (result.kind === 'exit') {
      await terminateRunInTx(tx, id, 'completed', result.reason ?? null);
      return;
    }
    if (result.contextPatch) context = { ...context, ...result.contextPatch };

    if (result.scheduledForMs && result.scheduledForMs > 0) {
      const next = result.nextNodeId!;
      const fireAt = new Date(Date.now() + result.scheduledForMs);
      const newJob = await tickQueue.add(
        QUEUE_JOURNEY_TICK,
        { runId, expectedNodeId: next, expectedVersionId },
        { delay: result.scheduledForMs, jobId: `tick__${runId}__${next}__${fireAt.getTime()}` },
      );
      await tx.journeyRun.update({
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
    currentNodeId = result.nextNodeId!;
  }

  // Budget hit. Persist state, re-enqueue.
  logger.warn({ runId, currentNodeId }, 'journey-tick: budget hit, re-enqueueing');
  const newJob = await tickQueue.add(
    QUEUE_JOURNEY_TICK,
    { runId, expectedNodeId: currentNodeId, expectedVersionId },
    { jobId: `tick__${runId}__${currentNodeId}__budget` },
  );
  await tx.journeyRun.update({
    where: { id },
    data: {
      currentNodeId,
      context: context as Prisma.InputJsonValue,
      pendingJobId: String(newJob.id),
    },
  });
}

type StepKind =
  | { kind: 'continue'; nextNodeId: string; scheduledForMs?: number; contextPatch?: Record<string, unknown> }
  | { kind: 'wait' }
  | { kind: 'exit'; reason?: string };

async function executeNode(
  ctx: TickContext,
  subscriber: import('@prisma/client').Subscriber,
  node: JourneyNode,
  currentNodeId: string,
): Promise<StepKind> {
  switch (node.type) {
    case 'EventEntry':
    case 'SegmentEntry': {
      // Entry nodes are inert when reached by the runner — the trigger
      // already started the run pointing at entry.next. Just record + advance.
      await recordStepInTx(ctx.tx, ctx.runIdBigInt, currentNodeId, node.type, 'exited');
      return { kind: 'continue', nextNodeId: node.next };
    }

    case 'Delay': {
      const ms = computeDelayMs(node, (subscriber.traits as Record<string, unknown>) ?? {});
      await recordStepInTx(ctx.tx, ctx.runIdBigInt, currentNodeId, 'Delay', 'entered', { ms });
      return { kind: 'continue', nextNodeId: node.next, scheduledForMs: ms };
    }

    case 'Message': {
      // sendTemplate writes the Delivery row outside the run-tx (different
      // connection). That's intentional: the SES call lives there, and the
      // idempotency key on Delivery makes it safe across retries.
      const outcome = await sendTemplate({
        templateId: node.templateId,
        subscriber,
        journeyRunId: ctx.runIdBigInt,
        idempotencyKey: `jr:${ctx.runId}:${currentNodeId}`,
      });
      await recordStepInTx(
        ctx.tx, ctx.runIdBigInt, currentNodeId, 'Message',
        outcome.status === 'sent' ? 'exited'
          : outcome.status === 'failed' || outcome.status === 'inflight' ? 'errored'
          : 'skipped',
        {
          outcome: outcome.status,
          ...(outcome.status === 'sent' ? { deliveryId: outcome.deliveryId.toString() } : {}),
          ...(outcome.status === 'skipped' ? { reason: outcome.reason } : {}),
          ...(outcome.status === 'failed' ? { error: outcome.error.slice(0, 1000) } : {}),
          ...(outcome.status === 'inflight' ? { reason: 'inflight-orphan' } : {}),
        },
      );
      return { kind: 'continue', nextNodeId: node.next };
    }

    case 'WaitFor': {
      const expiresAt = new Date(Date.now() + node.timeoutSeconds * 1_000);
      const signalType = node.signal.kind;
      const signalKey =
        node.signal.kind === 'event' ? node.signal.event : String(node.signal.audienceId);
      const predicate =
        node.signal.kind === 'event' && node.signal.properties
          ? (node.signal.properties as unknown as Prisma.InputJsonValue)
          : undefined;

      await recordStepInTx(ctx.tx, ctx.runIdBigInt, currentNodeId, 'WaitFor', 'entered', {
        signalType, signalKey, expiresAt: expiresAt.toISOString(),
      });
      await ctx.tx.journeyWait.upsert({
        where: { runId: ctx.runIdBigInt },
        create: {
          runId: ctx.runIdBigInt,
          signalType,
          signalKey,
          ...(predicate !== undefined ? { predicate } : {}),
          expiresAt,
        },
        update: {
          signalType,
          signalKey,
          predicate: predicate !== undefined ? predicate : Prisma.JsonNull,
          expiresAt,
        },
      });
      await ctx.tx.journeyRun.update({
        where: { id: ctx.runIdBigInt },
        data: { status: 'waiting', scheduledFor: null, pendingJobId: null },
      });
      return { kind: 'wait' };
    }

    case 'SegmentSplit': {
      const member = await ctx.tx.audienceMember.findUnique({
        where: { audienceId_subscriberId: { audienceId: node.audienceId, subscriberId: subscriber.id } },
      });
      const branch = member ? node.trueNext : node.falseNext;
      await recordStepInTx(ctx.tx, ctx.runIdBigInt, currentNodeId, 'SegmentSplit', 'exited', {
        audienceId: node.audienceId,
        branch: member ? 'true' : 'false',
      });
      return { kind: 'continue', nextNodeId: branch };
    }

    case 'TraitSplit': {
      // Evaluates the predicates against the live subscriber.traits at the
      // moment of the split — no audience round-trip, so no staleness from
      // audience recompute lag. AND semantics across predicates.
      const traits = (subscriber.traits as Record<string, unknown> | null) ?? {};
      const failedKeys: string[] = [];
      // Iterate (rather than evaluatePredicates+early-out) so the audit
      // step can show *which* predicates failed when the run takes the
      // false branch — the most common debugging question for TraitSplit.
      for (const p of node.predicates) {
        if (!evaluatePredicate(p, traits)) failedKeys.push(p.key);
      }
      const matched = failedKeys.length === 0;
      const branch = matched ? node.trueNext : node.falseNext;
      await recordStepInTx(ctx.tx, ctx.runIdBigInt, currentNodeId, 'TraitSplit', 'exited', {
        branch: matched ? 'true' : 'false',
        predicateCount: node.predicates.length,
        // Cap at 10 keys so a misconfigured TraitSplit can't bloat the
        // step row's meta JSON. The full predicate list is in the
        // journey definition; this is just a debug breadcrumb.
        ...(failedKeys.length > 0 ? { failedPredicateKeys: failedKeys.slice(0, 10) } : {}),
      });
      return { kind: 'continue', nextNodeId: branch };
    }

    case 'Exit': {
      await recordStepInTx(ctx.tx, ctx.runIdBigInt, currentNodeId, 'Exit', 'exited', {
        ...(node.reason ? { reason: node.reason } : {}),
      });
      return { kind: 'exit', reason: node.reason };
    }
  }
}

// In-tx versions of the helpers, taking a TransactionClient instead of
// the global prisma client. Pre-existing prisma-using helpers in
// lib/journey.ts are kept for callers that don't have a tx.
async function recordStepInTx(
  tx: Prisma.TransactionClient,
  runId: bigint,
  nodeId: string,
  nodeType: string,
  outcome: 'entered' | 'exited' | 'skipped' | 'errored' | 'timed_out',
  meta?: Record<string, unknown>,
): Promise<void> {
  await tx.journeyRunStep.create({
    data: {
      runId,
      nodeId,
      nodeType,
      outcome,
      meta: ((meta ?? {}) as Prisma.InputJsonValue),
    },
  });
}

async function terminateRunInTx(
  tx: Prisma.TransactionClient,
  id: bigint,
  status: 'completed' | 'failed',
  exitReason: string | null,
): Promise<void> {
  await tx.journeyRun.update({
    where: { id },
    data: {
      status,
      completedAt: new Date(),
      ...(exitReason ? { exitReason } : {}),
      pendingJobId: null,
      scheduledFor: null,
    },
  });
  // Clean up any pending JourneyWait so a future signal doesn't try to
  // resume a terminated run. (H3.) The cascade-delete on JourneyRun
  // handles the eventual-row-delete case, but terminated runs stick
  // around for audit; deleting the wait now keeps signal handling fast.
  await tx.journeyWait.deleteMany({ where: { runId: id } });
}
