import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../lib/error.js';
import { param } from '../lib/params.js';
import { audit } from '../lib/audit.js';

import './_sideEffects.js';

export const suppressionsRouter = Router();
suppressionsRouter.use(requireAuth);

const addSchema = z.object({
  email: z.string().email().max(255),
  reason: z.enum(['hard_bounce', 'complaint', 'manual']).default('manual'),
  details: z.string().max(2000).optional().nullable(),
});

suppressionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query['limit'] ?? 100), 500);
    const cursor = req.query['cursor'] ? String(req.query['cursor']) : undefined;
    const rows = await prisma.suppression.findMany({
      take: limit,
      ...(cursor ? { cursor: { email: cursor }, skip: 1 } : {}),
      orderBy: { email: 'asc' },
    });
    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.email : null;
    res.json({ suppressions: rows, nextCursor });
  }),
);

suppressionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = addSchema.parse(req.body);
    const email = input.email.toLowerCase();
    const row = await prisma.suppression.upsert({
      where: { email },
      create: { email, reason: input.reason, details: input.details ?? null },
      update: { reason: input.reason, details: input.details ?? null },
    });
    await audit(req, 'suppression.add', `email:${email}`, { reason: input.reason });
    res.status(201).json({ suppression: row });
  }),
);

suppressionsRouter.delete(
  '/:email',
  asyncHandler(async (req, res) => {
    const email = decodeURIComponent(param(req, 'email')).toLowerCase();
    if (!email.includes('@')) throw new HttpError(400, 'Invalid email');
    await prisma.suppression.delete({ where: { email } }).catch(() => undefined);
    await audit(req, 'suppression.remove', `email:${email}`);
    res.status(204).end();
  }),
);
