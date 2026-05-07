import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/error.js';

import './_sideEffects.js';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

const EVENT_TYPES = ['track', 'identify', 'page', 'screen', 'group', 'alias'] as const;

const listQuerySchema = z.object({
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  type: z.enum(EVENT_TYPES).optional(),
  name: z.string().min(1).max(255).optional(),
  externalId: z.string().min(1).max(255).optional(),
  // Default scan window of 7 days bounds the chunk read on the Timescale
  // hypertable. The events page is a "recent" tail; deep history goes
  // through the per-subscriber export.
  sinceHours: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
});

eventsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const since = new Date(Date.now() - q.sinceHours * 60 * 60 * 1000);

    const where: Prisma.EventWhereInput = { receivedAt: { gte: since } };
    if (q.type) where.type = q.type;
    if (q.name) where.name = q.name;
    if (q.externalId) where.externalId = q.externalId;
    if (q.cursor) where.id = { lt: BigInt(q.cursor) };

    const rows = await prisma.event.findMany({
      where,
      orderBy: { id: 'desc' },
      take: q.limit,
    });

    // Hydrate subscriber summaries for the rows that resolved to a known
    // subscriber. Event has no Prisma relation to Subscriber (the FK is a
    // bare BigInt? on the hypertable), so we fan-in by id with one query.
    const subscriberIds = Array.from(
      new Set(rows.map((r) => r.subscriberId).filter((v): v is bigint => v != null)),
    );
    const subs = subscriberIds.length
      ? await prisma.subscriber.findMany({
          where: { id: { in: subscriberIds } },
          select: { id: true, externalId: true, email: true },
        })
      : [];
    const subById = new Map(subs.map((s) => [s.id.toString(), s]));

    const events = rows.map((r) => ({
      id: r.id.toString(),
      messageId: r.messageId,
      type: r.type,
      name: r.name,
      externalId: r.externalId,
      anonymousId: r.anonymousId,
      subscriber: r.subscriberId
        ? (() => {
            const s = subById.get(r.subscriberId.toString());
            return s ? { externalId: s.externalId, email: s.email } : null;
          })()
        : null,
      properties: r.properties,
      context: r.context,
      observedAt: r.observedAt.toISOString(),
      receivedAt: r.receivedAt.toISOString(),
      source: r.source,
    }));

    const nextCursor = rows.length === q.limit ? rows[rows.length - 1]!.id.toString() : null;
    res.json({ events, nextCursor });
  }),
);
