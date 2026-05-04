// JourneyRunner helpers — pure functions that step a JourneyRun forward
// one node at a time. Side effects (Delivery rows, JourneyRunStep audit,
// JourneyWait inserts) live in here too, but the BullMQ enqueue calls
// stay in the job processors so this stays unit-testable in isolation.

import {
  journeyDefinitionSchema,
  type JourneyDefinition,
  type JourneyNode,
} from '@pipelineflow-engagement/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../logger.js';

// Per-tick recursion bound — protects against pathological journey
// definitions (a chain of SegmentSplit/Exit nodes that would otherwise
// hot-loop the worker on a single job).
export const TICK_NODE_BUDGET = 50;

export function parseDefinition(raw: unknown): JourneyDefinition {
  return journeyDefinitionSchema.parse(raw);
}

export function lookupNode(def: JourneyDefinition, id: string): JourneyNode {
  const n = def.nodes[id];
  if (!n) throw new Error(`journey: node '${id}' not found`);
  return n;
}

// Compute Delay.delay → milliseconds from now, given subscriber.traits.timezone.
export function computeDelayMs(node: Extract<JourneyNode, { type: 'Delay' }>, subscriberTraits: Record<string, unknown>): number {
  if (node.delay.kind === 'seconds') {
    return node.delay.seconds * 1000;
  }
  // localized-time: next occurrence of (hour, minute) in subscriber's tz
  // (defaults to UTC). For Phase 2, we use Intl.DateTimeFormat to derive
  // the offset; if weekdays is set, find the next matching weekday.
  const tz = typeof subscriberTraits['timezone'] === 'string' ? (subscriberTraits['timezone'] as string) : 'UTC';
  const now = new Date();
  const target = nextLocalizedTime(now, node.delay.hour, node.delay.minute, node.delay.weekdays, tz);
  return Math.max(1_000, target.getTime() - now.getTime());
}

function nextLocalizedTime(
  from: Date,
  hour: number,
  minute: number,
  weekdays: number[] | undefined,
  tz: string,
): Date {
  // Strategy: get current local time in tz; build a candidate Date for
  // today at (hour, minute); if it's already passed (or weekday filter
  // rejects it), step day-by-day up to 14 days. Worst case (every other
  // weekday + same hour just passed) = 7-day step.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  });
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const probe = new Date(from.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const parts = Object.fromEntries(fmt.formatToParts(probe).map((p) => [p.type, p.value]));
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts['weekday'] ?? '');
    if (weekdays && weekdays.length > 0 && !weekdays.includes(wd)) continue;
    // Build a UTC instant that corresponds to local-tz (year, month, day, hour, minute).
    // Date.UTC() returns epoch for the given Y/M/D/h/m/s in UTC; we need to
    // adjust by the tz offset at that moment. Compute offset by formatting
    // the same probe and reading back the offset implied.
    const y = Number(parts['year']);
    const mo = Number(parts['month']) - 1;
    const d = Number(parts['day']);
    // Construct the candidate as if local-tz were UTC, then correct.
    const asIfUtc = Date.UTC(y, mo, d, hour, minute, 0);
    // Determine actual UTC for that wall time in tz: format `asIfUtc` into
    // tz and see how it differs from the wall components.
    const actualWallParts = Object.fromEntries(
      fmt.formatToParts(new Date(asIfUtc)).map((p) => [p.type, p.value]),
    );
    const wallY = Number(actualWallParts['year']);
    const wallMo = Number(actualWallParts['month']) - 1;
    const wallD = Number(actualWallParts['day']);
    const wallH = Number(actualWallParts['hour']);
    const wallMin = Number(actualWallParts['minute']);
    const drift =
      Date.UTC(wallY, wallMo, wallD, wallH, wallMin, 0) - asIfUtc;
    const candidate = new Date(asIfUtc - drift);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  // Pathological — return a 7-day fallback so the runner keeps moving.
  return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export interface StepResult {
  // 'continue' = caller should schedule the next tick (delay) or run inline
  //              (within TICK_NODE_BUDGET).
  // 'wait' = a JourneyWait row was created; caller leaves run.scheduledFor
  //          null, sets status='waiting'.
  // 'exit' = run completed; caller flips status, sets completedAt.
  next: 'continue' | 'wait' | 'exit';
  nextNodeId?: string;
  scheduledForMs?: number;       // delay until next tick, when continue+delay
  exitReason?: string;
}

export async function recordStep(
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

export async function isInAudience(
  tx: Prisma.TransactionClient,
  audienceId: number,
  subscriberId: bigint,
): Promise<boolean> {
  const row = await tx.audienceMember.findUnique({
    where: { audienceId_subscriberId: { audienceId, subscriberId } },
  });
  return row != null;
}

export function logBudgetHit(runId: bigint, nodeId: string): void {
  logger.warn(
    { runId: runId.toString(), nodeId, budget: TICK_NODE_BUDGET },
    'journey tick: hit per-tick node budget — re-enqueueing',
  );
}
