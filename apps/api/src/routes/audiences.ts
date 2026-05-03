import { Router } from 'express';
import {
  audienceCreateSchema,
  audienceUpdateSchema,
} from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../lib/error.js';
import {
  enqueueAudienceCompute,
  ensureAudienceComputeScheduled,
  unscheduleAudienceCompute,
} from '../lib/queue.js';
import { audit } from '../lib/audit.js';

import './_sideEffects.js';

export const audiencesRouter = Router();

audiencesRouter.use(requireAuth);

audiencesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.audience.findMany({ orderBy: { id: 'desc' } });
    res.json({ audiences: rows });
  }),
);

audiencesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const a = await prisma.audience.findUnique({ where: { id } });
    if (!a) throw new HttpError(404, 'Audience not found');
    res.json({ audience: a });
  }),
);

audiencesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = audienceCreateSchema.parse(req.body);
    const created = await prisma.audience.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        definition: input.definition,
        computeIntervalSeconds: input.computeIntervalSeconds,
      },
    });
    await ensureAudienceComputeScheduled(created.id, created.computeIntervalSeconds);
    await audit(req, 'audience.create', `audience:${created.id}`, { name: created.name });
    res.status(201).json({ audience: created });
  }),
);

audiencesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const input = audienceUpdateSchema.parse(req.body);
    const before = await prisma.audience.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, 'Audience not found');
    const updated = await prisma.audience.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        description: input.description ?? undefined,
        definition: input.definition ?? undefined,
        computeIntervalSeconds: input.computeIntervalSeconds ?? undefined,
        status: input.status ?? undefined,
      },
    });
    // Reschedule if interval or status changed.
    const intervalChanged =
      input.computeIntervalSeconds != null &&
      input.computeIntervalSeconds !== before.computeIntervalSeconds;
    if (intervalChanged || input.status === 'archived' || input.status === 'paused') {
      await unscheduleAudienceCompute(id);
    }
    if (updated.status === 'active') {
      await ensureAudienceComputeScheduled(updated.id, updated.computeIntervalSeconds);
    }
    await audit(req, 'audience.update', `audience:${id}`, { changes: input });
    res.json({ audience: updated });
  }),
);

audiencesRouter.post(
  '/:id/recompute',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const a = await prisma.audience.findUnique({ where: { id } });
    if (!a) throw new HttpError(404, 'Audience not found');
    const job = await enqueueAudienceCompute(id);
    await audit(req, 'audience.recompute', `audience:${id}`);
    res.status(202).json({ jobId: job.id });
  }),
);

audiencesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    await unscheduleAudienceCompute(id);
    await prisma.audience.delete({ where: { id } });
    await audit(req, 'audience.delete', `audience:${id}`);
    res.status(204).end();
  }),
);
