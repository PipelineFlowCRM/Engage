import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/error.js';

import './_sideEffects.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const [subscribers, audiences, templates, broadcasts, deliveriesLast24h, suppressions] =
      await Promise.all([
        prisma.subscriber.count(),
        prisma.audience.count({ where: { status: 'active' } }),
        prisma.template.count({ where: { status: 'published' } }),
        prisma.broadcast.count({ where: { status: { in: ['scheduled', 'running', 'snapshotting'] } } }),
        prisma.delivery.count({
          where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        }),
        prisma.suppression.count(),
      ]);

    const [bouncesLast24h, complaintsLast24h] = await Promise.all([
      prisma.delivery.count({
        where: { bouncedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
      prisma.delivery.count({
        where: { complainedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

    res.json({
      subscribers,
      activeAudiences: audiences,
      publishedTemplates: templates,
      activeBroadcasts: broadcasts,
      deliveriesLast24h,
      bouncesLast24h,
      complaintsLast24h,
      suppressions,
    });
  }),
);
