import { Router } from 'express';
import {
  subscriptionGroupCreateSchema,
  subscriptionGroupUpdateSchema,
} from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../lib/error.js';
import { audit } from '../lib/audit.js';

import './_sideEffects.js';

export const subscriptionGroupsRouter = Router();
subscriptionGroupsRouter.use(requireAuth);

subscriptionGroupsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.subscriptionGroup.findMany({ orderBy: { id: 'asc' } });
    res.json({ subscriptionGroups: rows });
  }),
);

subscriptionGroupsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = subscriptionGroupCreateSchema.parse(req.body);
    const row = await prisma.subscriptionGroup.create({ data: input });
    await audit(req, 'subscription_group.create', `group:${row.id}`, { name: row.name });
    res.status(201).json({ subscriptionGroup: row });
  }),
);

subscriptionGroupsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const input = subscriptionGroupUpdateSchema.parse(req.body);
    const row = await prisma.subscriptionGroup.update({ where: { id }, data: input });
    res.json({ subscriptionGroup: row });
  }),
);

subscriptionGroupsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    await prisma.subscriptionGroup.delete({ where: { id } });
    await audit(req, 'subscription_group.delete', `group:${id}`);
    res.status(204).end();
  }),
);
