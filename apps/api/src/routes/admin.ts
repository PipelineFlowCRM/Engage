import { Router } from 'express';
import { prisma } from '../db.js';
import { requireUserSession } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../lib/error.js';
import { param, queryString } from '../lib/params.js';
import { audit } from '../lib/audit.js';

import './_sideEffects.js';

export const adminRouter = Router();
adminRouter.use(requireUserSession);

// Operator audit log.
adminRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query['limit'] ?? 100), 500);
    const cursor = req.query['cursor'] ? BigInt(String(req.query['cursor'])) : undefined;
    const rows = await prisma.operatorAuditEvent.findMany({
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'desc' },
      include: { user: { select: { email: true, name: true } } },
    });
    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id.toString() : null;
    res.json({ events: rows, nextCursor });
  }),
);

// GDPR delete-by-externalId. Cascades through SubscriberTrait, AudienceMember,
// SubscriptionState. Anonymises Delivery rows (preserves stats; loses PII).
// Adds the email to Suppression so re-imports from the CRM don't resurrect.
adminRouter.delete(
  '/subscribers/:externalId',
  asyncHandler(async (req, res) => {
    const externalId = param(req, 'externalId');
    const sub = await prisma.subscriber.findUnique({ where: { externalId } });
    if (!sub) throw new HttpError(404, 'Subscriber not found');

    const email = sub.email?.toLowerCase() ?? null;
    await prisma.$transaction(async (tx) => {
      // Anonymise deliveries — keep aggregate stats but strip PII. SES
      // diagnostic codes embed the recipient address, so errorMessage and
      // providerMessageId need to go too.
      await tx.delivery.updateMany({
        where: { subscriberId: sub.id },
        data: {
          toEmail: 'redacted@example.invalid',
          subject: null,
          errorMessage: null,
          providerMessageId: null,
          meta: { redactedAt: new Date().toISOString() },
        },
      });
      if (email) {
        await tx.suppression.upsert({
          where: { email },
          create: { email, reason: 'manual', details: 'gdpr-delete' },
          update: { reason: 'manual', details: 'gdpr-delete' },
        });
      }
      await tx.subscriber.delete({ where: { id: sub.id } });
    });
    await audit(req, 'subscriber.delete', `externalId:${externalId}`, { reason: 'gdpr' });
    res.status(204).end();
  }),
);

// GDPR export for a single subscriber. Returns everything we know about them.
adminRouter.get(
  '/subscribers/:externalId/export',
  asyncHandler(async (req, res) => {
    const externalId = param(req, 'externalId');
    const sub = await prisma.subscriber.findUnique({
      where: { externalId },
      include: {
        traitsLog: { orderBy: { observedAt: 'asc' } },
        subscriptions: { include: { group: true } },
        deliveries: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!sub) throw new HttpError(404, 'Subscriber not found');
    // Events live in the hypertable — pull last year by default; operator can
    // re-call with ?since= for older windows.
    const since = req.query['since']
      ? new Date(String(req.query['since']))
      : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const events = await prisma.event.findMany({
      where: { subscriberId: sub.id, receivedAt: { gte: since } },
      orderBy: { receivedAt: 'asc' },
    });
    res.json({ subscriber: sub, events, exportedAt: new Date().toISOString() });
  }),
);

// Read-only Setting view (live SES quota, DKIM status, etc.).
adminRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
    res.json({ settings: rows });
  }),
);

// Deliverability snapshot + active alerts. The hourly rollup writes the
// snapshot into Setting('deliverability.snapshot'); alerts live in their
// own table with resolvedAt set when the metric falls back below threshold.
adminRouter.get(
  '/deliverability',
  asyncHandler(async (_req, res) => {
    const [snapshotRow, alerts] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'deliverability.snapshot' } }),
      prisma.deliverabilityAlert.findMany({
        where: { resolvedAt: null },
        orderBy: { triggeredAt: 'desc' },
      }),
    ]);
    res.json({
      snapshot: snapshotRow?.value ?? null,
      alerts,
    });
  }),
);
