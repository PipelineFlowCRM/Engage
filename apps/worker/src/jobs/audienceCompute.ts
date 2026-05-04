// Audience compute worker. Compiles the audience JSON definition into a
// SELECT, runs it under a per-audience advisory lock, and updates
// AudienceMember via INSERT ... ON CONFLICT + DELETE-by-stale-version.
//
// Lock semantics: the lock is now transaction-scoped via withAdvisoryLock
// (LOCK_NS.audience). Previous version used pg_try_advisory_lock at session
// scope, which leaked locks on worker crash because the unlock call
// could end up on a different pool connection.

import type { Job } from 'bullmq';
import {
  audienceDefinitionSchema,
  QUEUE_JOURNEY_TRIGGER,
  type AudienceComputeJobData,
  type AudienceComputeJobResult,
} from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { LOCK_NS, withAdvisoryLock } from '../lib/locks.js';
import { compileAudience } from '../lib/audienceCompiler.js';
import { journeyTriggerQueue as triggerQueue } from '../lib/queues.js';

// Hard cap on per-pass journey-trigger fan-out. Hit when an audience
// definition flips a large set of subscribers in one compute (typical
// cause: trait import). Surfaced in Audience.lastComputeWarning so the
// operator can investigate. 5000 keeps one pass under ~5s of enqueue work.
const MAX_TRIGGER_FAN_OUT = 5_000;

// Compute can take a while on a large hypertable; bump the tx timeout
// well above Prisma's 5s default.
const COMPUTE_TIMEOUT_MS = 5 * 60 * 1000;

interface ComputeOutcome {
  enteredIds: string[];
  exitedIds: string[];
  totalMembers: number;
  computeError: string | null;
  durationMs: number;
}

export async function processAudienceCompute(
  job: Job<AudienceComputeJobData, AudienceComputeJobResult>,
): Promise<AudienceComputeJobResult> {
  const start = Date.now();
  const { audienceId } = job.data;

  const outcome = await withAdvisoryLock<ComputeOutcome>(
    LOCK_NS.audience,
    audienceId,
    async (tx) => doCompute(tx, audienceId, start),
    { timeoutMs: COMPUTE_TIMEOUT_MS },
  );
  if (outcome === null) {
    logger.info({ audienceId }, 'audience compute skipped — another worker holds the lock');
    return { membersAdded: 0, membersRemoved: 0, totalMembers: 0, durationMs: 0 };
  }

  // Journey trigger fan-out. Done OUTSIDE the lock so the lock isn't
  // held while we hammer Redis. Counts are already capped at
  // MAX_TRIGGER_FAN_OUT inside the lock. addBulk batches the enqueue.
  if (outcome.enteredIds.length) {
    await triggerQueue
      .addBulk(
        outcome.enteredIds.map((sid) => ({
          name: QUEUE_JOURNEY_TRIGGER,
          data: { kind: 'audience-enter' as const, audienceId, subscriberId: sid },
        })),
      )
      .catch((err) => logger.warn({ err, audienceId }, 'audience-enter bulk enqueue failed'));
  }
  if (outcome.exitedIds.length) {
    await triggerQueue
      .addBulk(
        outcome.exitedIds.map((sid) => ({
          name: QUEUE_JOURNEY_TRIGGER,
          data: { kind: 'audience-exit' as const, audienceId, subscriberId: sid },
        })),
      )
      .catch((err) => logger.warn({ err, audienceId }, 'audience-exit bulk enqueue failed'));
  }

  return {
    membersAdded: outcome.enteredIds.length,
    membersRemoved: outcome.exitedIds.length,
    totalMembers: outcome.totalMembers,
    durationMs: outcome.durationMs,
  };
}

async function doCompute(
  tx: import('@prisma/client').Prisma.TransactionClient,
  audienceId: number,
  start: number,
): Promise<ComputeOutcome> {
  const audience = await tx.audience.findUnique({ where: { id: audienceId } });
  if (!audience) {
    logger.warn({ audienceId }, 'audience compute: row gone');
    return { enteredIds: [], exitedIds: [], totalMembers: 0, computeError: null, durationMs: 0 };
  }
  if (audience.status !== 'active') {
    return { enteredIds: [], exitedIds: [], totalMembers: 0, computeError: null, durationMs: 0 };
  }

  const definition = audienceDefinitionSchema.parse(audience.definition);
  const { sql: matchSql, params } = compileAudience(definition);
  const newVersion = audience.computeVersion + 1;

  const audIdIdx = params.length + 1;
  const verIdx = params.length + 2;
  const upsert = `
    WITH matches AS (${matchSql})
    INSERT INTO "AudienceMember" ("audienceId", "subscriberId", "computeVersion", "enteredAt")
    SELECT $${audIdIdx}::int, m.id, $${verIdx}::int, NOW()
    FROM matches m
    ON CONFLICT ("audienceId", "subscriberId") DO UPDATE
      SET "computeVersion" = EXCLUDED."computeVersion"
  `;

  let computeError: string | null = null;
  let enteredIds: string[] = [];
  let exitedIds: string[] = [];
  let totalMembers = 0;
  try {
    const upsertReturning = `${upsert} RETURNING "subscriberId"::text AS sid, (xmax = 0) AS just_inserted`;
    const upsertRows = await tx.$queryRawUnsafe<
      Array<{ sid: string; just_inserted: boolean }>
    >(upsertReturning, ...params, audienceId, newVersion);
    enteredIds = upsertRows.filter((r) => r.just_inserted).map((r) => r.sid);

    const totalRows = await tx.$queryRawUnsafe<Array<{ c: bigint }>>(
      `SELECT COUNT(*)::bigint AS c FROM "AudienceMember" WHERE "audienceId" = $1 AND "computeVersion" = $2`,
      audienceId, newVersion,
    );
    totalMembers = Number(totalRows[0]?.c ?? 0n);

    const deleted = await tx.$queryRawUnsafe<Array<{ sid: string }>>(
      `DELETE FROM "AudienceMember"
       WHERE "audienceId" = $1 AND "computeVersion" < $2
       RETURNING "subscriberId"::text AS sid`,
      audienceId, newVersion,
    );
    exitedIds = deleted.map((r) => r.sid);
  } catch (err) {
    logger.error({ err, audienceId }, 'audience compute SQL failed');
    computeError = err instanceof Error ? err.message : String(err);
    throw err;
  }

  // Storm guardrail.
  const warnings: string[] = [];
  if (enteredIds.length > MAX_TRIGGER_FAN_OUT) {
    warnings.push(
      `Capped at ${MAX_TRIGGER_FAN_OUT}/${enteredIds.length} audience-enter triggers — consider tightening the audience or splitting into batches`,
    );
    enteredIds = enteredIds.slice(0, MAX_TRIGGER_FAN_OUT);
  }
  if (exitedIds.length > MAX_TRIGGER_FAN_OUT) {
    warnings.push(
      `Capped at ${MAX_TRIGGER_FAN_OUT}/${exitedIds.length} audience-exit triggers`,
    );
    exitedIds = exitedIds.slice(0, MAX_TRIGGER_FAN_OUT);
  }

  const durationMs = Date.now() - start;
  await tx.audience.update({
    where: { id: audienceId },
    data: {
      memberCount: totalMembers,
      computeVersion: newVersion,
      lastComputedAt: new Date(),
      lastComputeMs: durationMs,
      lastComputeError: computeError,
      lastComputeWarning: warnings.length ? warnings.join('; ') : null,
    },
  });

  return { enteredIds, exitedIds, totalMembers, computeError, durationMs };
}
