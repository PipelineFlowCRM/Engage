import { Router } from 'express';
import {
  subscriberCreateSchema,
  subscriberUpdateSchema,
  subscriberListQuerySchema,
} from '@pipelineflow-engagement/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../lib/error.js';
import { param } from '../lib/params.js';

import './_sideEffects.js';

export const subscribersRouter = Router();

subscribersRouter.use(requireAuth);

// Cursor-paginated list. q matches email, externalId, or trait.name.
subscribersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = subscriberListQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {};
    if (q.source) where['source'] = q.source;
    if (q.q) {
      where['OR'] = [
        { email: { contains: q.q, mode: 'insensitive' } },
        { externalId: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    if (q.cursor) {
      where['id'] = { lt: BigInt(q.cursor) };
    }
    const rows = await prisma.subscriber.findMany({
      where,
      orderBy: { id: 'desc' },
      take: q.limit,
    });
    const nextCursor = rows.length === q.limit ? rows[rows.length - 1]!.id.toString() : null;
    res.json({ subscribers: rows, nextCursor });
  }),
);

subscribersRouter.get(
  '/:externalId',
  asyncHandler(async (req, res) => {
    const externalId = param(req, 'externalId');
    const sub = await prisma.subscriber.findUnique({
      where: { externalId },
      include: {
        subscriptions: { include: { group: true } },
        deliveries: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!sub) throw new HttpError(404, 'Subscriber not found');
    res.json({ subscriber: sub });
  }),
);

subscribersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = subscriberCreateSchema.parse(req.body);
    const traitsCreate = (input.traits ?? {}) as Prisma.InputJsonValue;
    let traitsUpdate: Prisma.InputJsonValue | undefined = undefined;
    if (input.traits) {
      const existing = await prisma.subscriber.findUnique({ where: { externalId: input.externalId } });
      const merged = { ...((existing?.traits as object) ?? {}), ...input.traits };
      traitsUpdate = merged as Prisma.InputJsonValue;
    }
    const sub = await prisma.subscriber.upsert({
      where: { externalId: input.externalId },
      create: {
        externalId: input.externalId,
        email: input.email ?? null,
        phone: input.phone ?? null,
        traits: traitsCreate,
        source: input.source ?? 'api',
      },
      update: {
        email: input.email ?? undefined,
        phone: input.phone ?? undefined,
        // Merge traits rather than replacing — manual create on an existing
        // subscriber is rare but should be additive.
        traits: traitsUpdate,
      },
    });
    res.status(201).json({ subscriber: sub });
  }),
);

subscribersRouter.patch(
  '/:externalId',
  asyncHandler(async (req, res) => {
    const input = subscriberUpdateSchema.parse(req.body);
    const externalId = param(req, 'externalId');
    const sub = await prisma.subscriber.update({
      where: { externalId },
      data: {
        email: input.email ?? undefined,
        phone: input.phone ?? undefined,
        traits: (input.traits ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    res.json({ subscriber: sub });
  }),
);
