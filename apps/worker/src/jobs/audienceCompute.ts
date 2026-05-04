// Audience compute worker. Compiles the audience JSON definition into a
// SELECT, runs it under a per-audience advisory lock, and updates
// AudienceMember via INSERT … ON CONFLICT + DELETE-by-stale-version.

import type { Job } from 'bullmq';
import {
  audienceDefinitionSchema,
  QUEUE_JOURNEY_TRIGGER,
  type AudienceComputeJobData,
  type AudienceComputeJobResult,
  type JourneyTriggerJobData,
} from '@pipelineflow-engagement/shared';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { redisConnection } from '../lib/redis.js';
import { compileAudience } from '../lib/audienceCompiler.js';

const triggerQueue = new Queue<JourneyTriggerJobData>(
  QUEUE_JOURNEY_TRIGGER,
  { connection: redisConnection },
);

// Hard cap on per-pass journey-trigger fan-out. Hit when an audience
// definition flips a large set of subscribers in one compute (typical
// cause: trait import). Surfaced in Audience.lastComputeWarning so the
// operator can investigate. Tuneable via env later if needed; 5000 is
// chosen to keep one pass under ~5 seconds of enqueue work.
const MAX_TRIGGER_FAN_OUT = 5_000;

export async function processAudienceCompute(
  job: Job<AudienceComputeJobData, AudienceComputeJobResult>,
): Promise<AudienceComputeJobResult> {
  const start = Date.now();
  const { audienceId } = job.data;

  // Try to acquire advisory lock. If another worker is already computing
  // this audience, return a no-op result.
  const locked = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(${audienceId}::bigint) AS locked
  `;
  if (!locked[0]?.locked) {
    logger.info({ audienceId }, 'audience compute skipped — another worker holds the lock');
    return { membersAdded: 0, membersRemoved: 0, totalMembers: 0, durationMs: 0 };
  }

  try {
    const audience = await prisma.audience.findUnique({ where: { id: audienceId } });
    if (!audience) {
      logger.warn({ audienceId }, 'audience compute: row gone');
      return { membersAdded: 0, membersRemoved: 0, totalMembers: 0, durationMs: 0 };
    }
    if (audience.status !== 'active') {
      return { membersAdded: 0, membersRemoved: 0, totalMembers: 0, durationMs: 0 };
    }

    const definition = audienceDefinitionSchema.parse(audience.definition);
    const { sql: matchSql, params } = compileAudience(definition);
    const newVersion = audience.computeVersion + 1;

    // Build the upsert. We pass the matchSql + params verbatim, plus our own
    // audienceId/version params. Track index offsets carefully.
    //
    // Layout: [...matchParams, audienceId, version]
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

    let membersAdded = 0;
    let membersRemoved = 0;
    let totalMembers = 0;
    let computeError: string | null = null;
    // Captured for journey-trigger fan-out below. Bigints serialised to
    // strings since the trigger payload is JSON-serialised by BullMQ.
    let enteredIds: string[] = [];
    let exitedIds: string[] = [];
    try {
      // Upsert with RETURNING xmax = 0 to distinguish freshly-inserted
      // (entered) from updates (already-members).
      const upsertReturning = `${upsert} RETURNING "subscriberId"::text AS sid, (xmax = 0) AS just_inserted`;
      const upsertRows = await prisma.$queryRawUnsafe<
        Array<{ sid: string; just_inserted: boolean }>
      >(upsertReturning, ...params, audienceId, newVersion);
      enteredIds = upsertRows.filter((r) => r.just_inserted).map((r) => r.sid);

      // Total at new version.
      const totalRows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
        `SELECT COUNT(*)::bigint AS c FROM "AudienceMember" WHERE "audienceId" = $1 AND "computeVersion" = $2`,
        audienceId, newVersion,
      );
      totalMembers = Number(totalRows[0]?.c ?? 0n);

      // Deletes: rows we didn't touch this pass.
      const deleted = await prisma.$queryRawUnsafe<Array<{ sid: string }>>(
        `DELETE FROM "AudienceMember"
         WHERE "audienceId" = $1 AND "computeVersion" < $2
         RETURNING "subscriberId"::text AS sid`,
        audienceId, newVersion,
      );
      exitedIds = deleted.map((r) => r.sid);
      membersRemoved = exitedIds.length;
      membersAdded = enteredIds.length;
    } catch (err) {
      logger.error({ err, audienceId }, 'audience compute SQL failed');
      computeError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      // ─── Storm guardrail ──────────────────────────────────────────────
      // A trait import that flips 100k subscribers into an audience would
      // otherwise enqueue 100k journey-trigger jobs. We cap at
      // MAX_TRIGGER_FAN_OUT per pass and surface the cap in
      // Audience.lastComputeWarning so the operator notices.
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
      await prisma.audience.update({
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
    }

    // Journey trigger fan-out. Done outside the lock-protected region so the
    // advisory lock isn't held while we enqueue. Per-subscriber jobs let the
    // trigger worker's run-start dedup do the heavy lifting; counts are
    // already capped above by the storm guardrail.
    for (const sid of enteredIds) {
      await triggerQueue
        .add(QUEUE_JOURNEY_TRIGGER, { kind: 'audience-enter', audienceId, subscriberId: sid })
        .catch((err) => logger.warn({ err, sid, audienceId }, 'failed to enqueue audience-enter trigger'));
    }
    for (const sid of exitedIds) {
      await triggerQueue
        .add(QUEUE_JOURNEY_TRIGGER, { kind: 'audience-exit', audienceId, subscriberId: sid })
        .catch((err) => logger.warn({ err, sid, audienceId }, 'failed to enqueue audience-exit trigger'));
    }

    return {
      membersAdded,
      membersRemoved,
      totalMembers,
      durationMs: Date.now() - start,
    };
  } finally {
    await prisma.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(${audienceId}::bigint)`);
  }
}
