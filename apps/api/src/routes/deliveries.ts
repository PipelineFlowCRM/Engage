import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../lib/error.js';
import { param } from '../lib/params.js';

import './_sideEffects.js';

export const deliveriesRouter = Router();
deliveriesRouter.use(requireAuth);

const listSchema = z.object({
  status: z.string().optional(),
  broadcastId: z.coerce.number().optional(),
  subscriberId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(), // BigInt id
});

deliveriesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listSchema.parse(req.query);
    const where: Record<string, unknown> = {};
    if (q.status) where['status'] = q.status;
    if (q.broadcastId) where['broadcastId'] = q.broadcastId;
    if (q.subscriberId) where['subscriberId'] = BigInt(q.subscriberId);
    if (q.cursor) where['id'] = { lt: BigInt(q.cursor) };

    const rows = await prisma.delivery.findMany({
      where,
      orderBy: { id: 'desc' },
      take: q.limit,
      include: { subscriber: { select: { externalId: true, email: true } }, template: { select: { name: true } } },
    });
    const nextCursor = rows.length === q.limit ? rows[rows.length - 1]!.id.toString() : null;
    res.json({ deliveries: rows, nextCursor });
  }),
);

deliveriesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    let id: bigint;
    try { id = BigInt(param(req, 'id')); } catch { throw new HttpError(400, 'Invalid id'); }
    const row = await prisma.delivery.findUnique({
      where: { id },
      include: {
        subscriber: { select: { id: true, externalId: true, email: true } },
        template: { select: { id: true, name: true } },
      },
    });
    if (!row) throw new HttpError(404, 'Delivery not found');
    res.json({ delivery: row });
  }),
);
