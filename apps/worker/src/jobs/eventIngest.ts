// Event ingest worker. Per-message: upsert subscriber, merge traits,
// write Event row idempotently (ON CONFLICT messageId DO NOTHING).

import type { Job } from 'bullmq';
import {
  QUEUE_JOURNEY_TRIGGER,
  type EventIngestJobData,
  type EventIngestJobResult,
  type JourneyTriggerJobData,
} from '@pipelineflow-engagement/shared';
import type { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { redisConnection } from '../lib/redis.js';

const triggerQueue = new Queue<JourneyTriggerJobData>(
  QUEUE_JOURNEY_TRIGGER,
  { connection: redisConnection },
);

export async function processEventIngest(
  job: Job<EventIngestJobData, EventIngestJobResult>,
): Promise<EventIngestJobResult> {
  const data = job.data;

  // Resolve subscriber. Two paths:
  //   1) externalId present → upsert by externalId, mark anonymousId on it.
  //   2) externalId absent, anonymousId present → upsert by externalId of
  //      `anon:<anonymousId>` (synthetic). identify() later replaces this
  //      with the real externalId.
  const externalId = data.externalId ?? (data.anonymousId ? `anon:${data.anonymousId}` : null);
  if (!externalId) {
    return { outcome: 'rejected' };
  }

  const result = await prisma.$transaction(async (tx) => {
    // Per-subscriber serial lock so two concurrent identify() calls don't
    // race the trait merge. Lock is released at tx commit.
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      externalId,
    );

    let sub = await tx.subscriber.findUnique({ where: { externalId } });

    // identify(): create or update; merge traits.
    if (data.type === 'identify') {
      const incomingTraits = (data.traits ?? {}) as Record<string, unknown>;
      const email = pickEmail(incomingTraits);
      const phone = pickPhone(incomingTraits);
      if (!sub) {
        sub = await tx.subscriber.create({
          data: {
            externalId,
            anonymousIds: data.anonymousId ? [data.anonymousId] : [],
            email: email ?? null,
            phone: phone ?? null,
            traits: incomingTraits as Prisma.InputJsonValue,
            source: data.source,
          },
        });
      } else {
        const merged = { ...((sub.traits as object) ?? {}), ...incomingTraits };
        const anonymousIds =
          data.anonymousId && !sub.anonymousIds.includes(data.anonymousId)
            ? [...sub.anonymousIds, data.anonymousId]
            : sub.anonymousIds;
        sub = await tx.subscriber.update({
          where: { id: sub.id },
          data: {
            traits: merged as Prisma.InputJsonValue,
            anonymousIds,
            // Don't blow away an existing email/phone with null.
            email: email ?? sub.email,
            phone: phone ?? sub.phone,
            updatedAt: new Date(),
          },
        });
      }
      // Append-only trait lineage.
      const lineageRows = Object.entries(incomingTraits).map(([key, value]) => ({
        subscriberId: sub!.id,
        key,
        value: value as unknown,
        source: data.source === 'crm' ? 'crm' : 'identify',
      }));
      if (lineageRows.length) {
        // createMany doesn't accept Json values directly with type checks
        // satisfied; fall back to per-row create.
        for (const r of lineageRows) {
          await tx.subscriberTrait.create({
            data: { subscriberId: r.subscriberId, key: r.key, value: r.value as object, source: r.source },
          });
        }
      }
    }

    // alias(): redirect previousId's events to userId.
    if (data.type === 'alias') {
      if (data.previousId && data.externalId) {
        const prev = await tx.subscriber.findUnique({ where: { externalId: data.previousId } });
        if (prev && prev.externalId !== data.externalId) {
          // Move events first (still safe — composite PK is (id, receivedAt)).
          await tx.event.updateMany({
            where: { subscriberId: prev.id },
            data: { subscriberId: sub?.id ?? null },
          });
          // Merge anonymousIds + traits.
          if (sub) {
            const merged = { ...((prev.traits as object) ?? {}), ...((sub.traits as object) ?? {}) };
            const ids = Array.from(new Set([...prev.anonymousIds, ...sub.anonymousIds]));
            await tx.subscriber.update({
              where: { id: sub.id },
              data: { traits: merged, anonymousIds: ids, updatedAt: new Date() },
            });
          }
          await tx.subscriber.delete({ where: { id: prev.id } });
        }
      }
    }

    // Backfill: events that arrived before identify() carried only
    // anonymousId. Now that we have externalId, link them.
    if (data.type === 'identify' && data.anonymousId && sub) {
      await tx.event.updateMany({
        where: { anonymousId: data.anonymousId, subscriberId: null },
        data: { subscriberId: sub.id, externalId },
      });
    }

    // Make sure we have a Subscriber row for non-identify events too.
    if (!sub && data.type !== 'alias') {
      sub = await tx.subscriber.create({
        data: {
          externalId,
          anonymousIds: data.anonymousId ? [data.anonymousId] : [],
          email: null,
          phone: null,
          traits: {},
          source: data.source,
        },
      });
    }

    // Insert the Event row. Idempotent via partial unique index on messageId.
    // Use raw SQL for ON CONFLICT (Prisma can't express partial uniques).
    const inserted = await tx.$executeRaw`
      INSERT INTO "Event" (
        "messageId", "type", "subscriberId", "anonymousId", "externalId",
        "name", "properties", "context", "observedAt", "receivedAt", "source"
      ) VALUES (
        ${data.messageId},
        ${data.type},
        ${sub?.id ?? null}::bigint,
        ${data.anonymousId ?? null},
        ${externalId},
        ${data.name ?? null},
        ${JSON.stringify(data.properties ?? {})}::jsonb,
        ${JSON.stringify(data.context ?? {})}::jsonb,
        ${new Date(data.observedAt)},
        ${new Date(data.receivedAt)},
        ${data.source}
      )
      ON CONFLICT ("messageId") WHERE "messageId" IS NOT NULL DO NOTHING
    `;
    return { outcome: inserted > 0 ? 'inserted' : 'duplicate', subscriberId: sub?.id?.toString() } as const;
  });

  if (result.outcome === 'duplicate') {
    logger.debug({ messageId: data.messageId }, 'event already ingested');
  }

  // Journey trigger fan-out. Only for newly-inserted track() events with a
  // resolved subscriber. Identify/page/alias don't drive entry/wait matches
  // in Phase 2.
  if (
    result.outcome === 'inserted' &&
    data.type === 'track' &&
    data.name &&
    result.subscriberId
  ) {
    await triggerQueue
      .add(QUEUE_JOURNEY_TRIGGER, {
        kind: 'event',
        event: data.name,
        subscriberId: result.subscriberId,
        eventMessageId: data.messageId,
        properties: data.properties ?? null,
      })
      .catch((err) => logger.warn({ err, event: data.name }, 'failed to enqueue event trigger'));
  }

  return result;
}

function pickEmail(traits: Record<string, unknown>): string | undefined {
  const v = traits['email'] ?? traits['Email'];
  return typeof v === 'string' ? v : undefined;
}
function pickPhone(traits: Record<string, unknown>): string | undefined {
  const v = traits['phone'] ?? traits['Phone'];
  return typeof v === 'string' ? v : undefined;
}
