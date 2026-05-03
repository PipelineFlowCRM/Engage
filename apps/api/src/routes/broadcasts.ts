import { Router } from 'express';
import {
  broadcastActionSchema,
  broadcastCreateSchema,
  broadcastUpdateSchema,
} from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../lib/error.js';
import { enqueueBroadcastLaunch } from '../lib/queue.js';
import { audit } from '../lib/audit.js';

import './_sideEffects.js';

export const broadcastsRouter = Router();

broadcastsRouter.use(requireAuth);

broadcastsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.broadcast.findMany({
      include: { template: true, audience: true },
      orderBy: { id: 'desc' },
    });
    res.json({ broadcasts: rows });
  }),
);

broadcastsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const b = await prisma.broadcast.findUnique({
      where: { id },
      include: { template: { include: { subscriptionGroup: true } }, audience: true },
    });
    if (!b) throw new HttpError(404, 'Broadcast not found');
    res.json({ broadcast: b });
  }),
);

broadcastsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = broadcastCreateSchema.parse(req.body);
    // Light validation — template must be published, must have a
    // subscriptionGroup; audience must be active.
    const [tpl, aud] = await Promise.all([
      prisma.template.findUnique({ where: { id: input.templateId } }),
      prisma.audience.findUnique({ where: { id: input.audienceId } }),
    ]);
    if (!tpl) throw new HttpError(400, 'Template not found');
    if (!aud) throw new HttpError(400, 'Audience not found');
    if (tpl.subscriptionGroupId == null) {
      throw new HttpError(400, 'Template must have a subscription group before broadcasting');
    }
    const created = await prisma.broadcast.create({
      data: {
        name: input.name,
        templateId: input.templateId,
        audienceId: input.audienceId,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        sendRatePerSecond: input.sendRatePerSecond,
        status: input.scheduledFor ? 'scheduled' : 'draft',
      },
    });
    await audit(req, 'broadcast.create', `broadcast:${created.id}`, { name: created.name });
    res.status(201).json({ broadcast: created });
  }),
);

broadcastsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const input = broadcastUpdateSchema.parse(req.body);
    const existing = await prisma.broadcast.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Broadcast not found');
    if (existing.status !== 'draft' && existing.status !== 'scheduled') {
      throw new HttpError(409, `Cannot edit broadcast in status '${existing.status}'`);
    }
    const updated = await prisma.broadcast.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        templateId: input.templateId ?? undefined,
        audienceId: input.audienceId ?? undefined,
        scheduledFor: input.scheduledFor !== undefined ? (input.scheduledFor ? new Date(input.scheduledFor) : null) : undefined,
        sendRatePerSecond: input.sendRatePerSecond ?? undefined,
      },
    });
    res.json({ broadcast: updated });
  }),
);

// State actions — launch / pause / resume / cancel.
broadcastsRouter.post(
  '/:id/actions',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const { action } = broadcastActionSchema.parse(req.body);
    const b = await prisma.broadcast.findUnique({ where: { id } });
    if (!b) throw new HttpError(404, 'Broadcast not found');

    switch (action) {
      case 'launch': {
        if (b.status !== 'draft' && b.status !== 'scheduled') {
          throw new HttpError(409, `Cannot launch broadcast in status '${b.status}'`);
        }
        await prisma.broadcast.update({
          where: { id },
          data: { status: 'snapshotting', startedAt: new Date() },
        });
        const job = await enqueueBroadcastLaunch(id);
        await prisma.broadcast.update({
          where: { id },
          data: { runJobId: String(job.id) },
        });
        await audit(req, 'broadcast.launch', `broadcast:${id}`);
        break;
      }
      case 'pause': {
        if (b.status !== 'running') throw new HttpError(409, `Cannot pause broadcast in status '${b.status}'`);
        await prisma.broadcast.update({ where: { id }, data: { status: 'paused' } });
        await audit(req, 'broadcast.pause', `broadcast:${id}`);
        break;
      }
      case 'resume': {
        if (b.status !== 'paused') throw new HttpError(409, `Cannot resume broadcast in status '${b.status}'`);
        await prisma.broadcast.update({ where: { id }, data: { status: 'running' } });
        // Re-enqueue any remaining pending rows; the launch job is idempotent
        // and will skip already-completed work.
        await enqueueBroadcastLaunch(id);
        await audit(req, 'broadcast.resume', `broadcast:${id}`);
        break;
      }
      case 'cancel': {
        if (b.status === 'completed' || b.status === 'cancelled') {
          throw new HttpError(409, `Broadcast already ${b.status}`);
        }
        await prisma.$transaction([
          prisma.broadcast.update({
            where: { id },
            data: { status: 'cancelled', completedAt: new Date() },
          }),
          prisma.broadcastDelivery.updateMany({
            where: { broadcastId: id, status: 'pending' },
            data: { status: 'skipped', skipReason: 'cancelled' },
          }),
        ]);
        await audit(req, 'broadcast.cancel', `broadcast:${id}`);
        break;
      }
    }

    const updated = await prisma.broadcast.findUnique({ where: { id } });
    res.json({ broadcast: updated });
  }),
);

broadcastsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const b = await prisma.broadcast.findUnique({ where: { id } });
    if (!b) throw new HttpError(404, 'Broadcast not found');
    if (b.status === 'running' || b.status === 'snapshotting') {
      throw new HttpError(409, 'Cancel the broadcast before deleting');
    }
    await prisma.broadcast.delete({ where: { id } });
    await audit(req, 'broadcast.delete', `broadcast:${id}`);
    res.status(204).end();
  }),
);
