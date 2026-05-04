import { Router } from 'express';
import { preferencesUpdateSchema } from '@pipelineflow-engagement/shared';
import { prisma } from '../../db.js';
import { asyncHandler, HttpError } from '../../lib/error.js';
import { param } from '../../lib/params.js';
import { verifyPreferencesToken } from '../../lib/preferencesJwt.js';
import { enqueueCrmActivityPush } from '../../lib/queue.js';

import '../_sideEffects.js';

export const preferencesRouter = Router();

// Public, token-gated. The JWT in the URL identifies the subscriber; no
// session cookie required. Unsubscribe-link clicks are GET (one-click);
// the preferences page itself is GET + POST.

preferencesRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const payload = await verifyPreferencesToken(param(req, 'token'));
    const subscriberId = BigInt(payload.sub);
    const sub = await prisma.subscriber.findUnique({ where: { id: subscriberId } });
    if (!sub) throw new HttpError(404, 'Subscriber not found');
    const groups = await prisma.subscriptionGroup.findMany({ orderBy: { name: 'asc' } });
    const states = await prisma.subscriptionState.findMany({
      where: { subscriberId },
    });
    const stateByGroup = new Map(states.map((s) => [s.groupId, s.status]));
    res.json({
      subscriber: { externalId: sub.externalId, email: sub.email },
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        type: g.type,
        // For opt_out groups: default = subscribed. For opt_in: default = unsubscribed.
        status: stateByGroup.get(g.id) ?? (g.type === 'opt_out' ? 'subscribed' : 'unsubscribed'),
      })),
    });
  }),
);

preferencesRouter.post(
  '/:token',
  asyncHandler(async (req, res) => {
    const payload = await verifyPreferencesToken(param(req, 'token'));
    const subscriberId = BigInt(payload.sub);
    const input = preferencesUpdateSchema.parse(req.body);
    const updates = Object.entries(input.subscriptions);
    await prisma.$transaction(async (tx) => {
      for (const [groupIdStr, status] of updates) {
        const groupId = Number(groupIdStr);
        await tx.subscriptionState.upsert({
          where: { subscriberId_groupId: { subscriberId, groupId } },
          create: { subscriberId, groupId, status, source: 'preference-center' },
          update: { status, source: 'preference-center', changedAt: new Date() },
        });
      }
    });
    res.status(204).end();
  }),
);

// One-click unsubscribe via mailto/link. Defaults to 'marketing' group; if
// a templateGroupId query param is present (auto-injected at render), uses
// that. Mailbox providers (Gmail, Apple Mail) POST here without bodies via
// the List-Unsubscribe-Post header.
preferencesRouter.get(
  '/:token/unsubscribe',
  asyncHandler(async (req, res) => {
    const payload = await verifyPreferencesToken(param(req, 'token'));
    const subscriberId = BigInt(payload.sub);
    const groupIdRaw = req.query['groupId'];
    const groupId = groupIdRaw ? Number(groupIdRaw) : null;
    if (groupId == null || !Number.isFinite(groupId)) {
      throw new HttpError(400, 'Missing or invalid groupId');
    }
    await prisma.subscriptionState.upsert({
      where: { subscriberId_groupId: { subscriberId, groupId } },
      create: { subscriberId, groupId, status: 'unsubscribed', source: 'list-unsubscribe' },
      update: { status: 'unsubscribed', source: 'list-unsubscribe', changedAt: new Date() },
    });
    // Fan out to CRM. We don't have a specific Delivery row at unsubscribe
    // time (the unsubscribe could have come from any past send), so we send
    // the most recent Delivery to that subscriber as the canonical context.
    const recent = await prisma.delivery.findFirst({
      where: { subscriberId },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    if (recent) {
      await enqueueCrmActivityPush({ deliveryId: recent.id.toString(), event: 'unsubscribed' });
    }
    res.json({ unsubscribed: true });
  }),
);
preferencesRouter.post(
  '/:token/unsubscribe',
  asyncHandler(async (req, res) => {
    // Same as GET — exists so List-Unsubscribe-Post one-click works.
    const payload = await verifyPreferencesToken(param(req, 'token'));
    const subscriberId = BigInt(payload.sub);
    const groupId = Number(req.query['groupId']);
    if (!Number.isFinite(groupId)) throw new HttpError(400, 'Missing groupId');
    await prisma.subscriptionState.upsert({
      where: { subscriberId_groupId: { subscriberId, groupId } },
      create: { subscriberId, groupId, status: 'unsubscribed', source: 'list-unsubscribe' },
      update: { status: 'unsubscribed', source: 'list-unsubscribe', changedAt: new Date() },
    });
    res.status(204).end();
  }),
);
