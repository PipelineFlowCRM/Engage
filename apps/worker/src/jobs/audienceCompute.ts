// Audience compute worker. Compiles the audience JSON definition into a
// SELECT, runs it under a per-audience advisory lock, and updates
// AudienceMember via INSERT … ON CONFLICT + DELETE-by-stale-version.

import type { Job } from 'bullmq';
import type { AudienceComputeJobData, AudienceComputeJobResult } from '@pipelineflow-engagement/shared';
import { audienceDefinitionSchema } from '@pipelineflow-engagement/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { compileAudience } from '../lib/audienceCompiler.js';

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
    try {
      // Use $executeRawUnsafe; Prisma's tagged-template raw doesn't support
      // dynamic placeholders cleanly when the SQL itself is dynamic.
      await prisma.$executeRawUnsafe(upsert, ...params, audienceId, newVersion);

      // Count delta. Members where computeVersion was bumped this pass were
      // existing-or-newly-inserted. We need to distinguish — so first count
      // current total at new version, then subtract prior count to get net.
      const totalRows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
        `SELECT COUNT(*)::bigint AS c FROM "AudienceMember" WHERE "audienceId" = $1 AND "computeVersion" = $2`,
        audienceId, newVersion,
      );
      totalMembers = Number(totalRows[0]?.c ?? 0n);

      // Deletes: rows we didn't touch this pass.
      const deleted = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
        `WITH d AS (
           DELETE FROM "AudienceMember"
           WHERE "audienceId" = $1 AND "computeVersion" < $2
           RETURNING 1
         ) SELECT COUNT(*)::bigint AS c FROM d`,
        audienceId, newVersion,
      );
      membersRemoved = Number(deleted[0]?.c ?? 0n);
      membersAdded = Math.max(0, totalMembers - (audience.memberCount - membersRemoved));
    } catch (err) {
      logger.error({ err, audienceId }, 'audience compute SQL failed');
      computeError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const durationMs = Date.now() - start;
      await prisma.audience.update({
        where: { id: audienceId },
        data: {
          memberCount: totalMembers,
          computeVersion: newVersion,
          lastComputedAt: new Date(),
          lastComputeMs: durationMs,
          lastComputeError: computeError,
        },
      });
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
