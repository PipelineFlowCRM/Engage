import { Router } from 'express';
import type { Request } from 'express';
import { crmWebhookPayloadSchema } from '@pipelineflow-engagement/shared';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { asyncHandler, HttpError } from '../../lib/error.js';
import { verifyCrmWebhookSignature } from '../../lib/crmAuth.js';
import { enqueueEventIngest } from '../../lib/queue.js';
import { randomUUID } from 'node:crypto';

import '../_sideEffects.js';

export const crmWebhookRouter = Router();

crmWebhookRouter.post(
  '/crm',
  asyncHandler(async (req: Request, res) => {
    if (!env.CRM_SHARED_SECRET) {
      throw new HttpError(503, 'CRM bridge not configured');
    }
    const raw = req.body as Buffer | undefined;
    if (!raw) throw new HttpError(400, 'Empty body');
    verifyCrmWebhookSignature(req, raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new HttpError(400, 'Body is not JSON');
    }
    const payload = crmWebhookPayloadSchema.parse(parsed);

    if (payload.type === 'contact') {
      const externalId = `crm:contact:${payload.contact.id}`;
      if (payload.action === 'deleted') {
        // Soft-handle: keep history (subscription state, deliveries) but mark
        // unreachable. The CRM has its own delete; full GDPR is via /api/admin.
        await prisma.subscriber.updateMany({
          where: { externalId },
          data: { source: 'crm', updatedAt: new Date() },
        });
      } else {
        const fullName = [payload.contact.firstName, payload.contact.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();
        const traits: Record<string, unknown> = {
          ...(payload.contact.firstName ? { firstName: payload.contact.firstName } : {}),
          ...(payload.contact.lastName ? { lastName: payload.contact.lastName } : {}),
          ...(fullName ? { fullName } : {}),
          ...(payload.contact.title ? { title: payload.contact.title } : {}),
          ...(payload.contact.companyName ? { company: payload.contact.companyName } : {}),
          ...(payload.contact.tags ? { crmTags: payload.contact.tags } : {}),
          ...(payload.contact.customFields ?? {}),
        };
        // Route through the events ingest worker so the merge path is the
        // same as Segment.com identify(). source='crm' tags it for loop
        // detection on the outbound push.
        await enqueueEventIngest({
          type: 'identify',
          messageId: randomUUID(),
          externalId,
          anonymousId: null,
          previousId: null,
          traits,
          name: null,
          properties: null,
          context: { source: 'crm-webhook' },
          observedAt: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
          source: 'crm',
        });
        // We also write to Subscriber directly so direct-readers see the
        // canonical email/phone immediately rather than waiting for the
        // worker. The worker upsert is idempotent.
        await prisma.subscriber.upsert({
          where: { externalId },
          create: {
            externalId,
            email: payload.contact.email ?? null,
            phone: payload.contact.phone ?? null,
            traits: traits as object,
            source: 'crm',
          },
          update: {
            email: payload.contact.email ?? undefined,
            phone: payload.contact.phone ?? undefined,
          },
        });
      }
    } else {
      // Activity event → track()
      const externalId = `crm:contact:${payload.contactId}`;
      await enqueueEventIngest({
        type: 'track',
        messageId: randomUUID(),
        externalId,
        anonymousId: null,
        previousId: null,
        traits: null,
        name: payload.event,
        properties: payload.properties ?? null,
        context: { source: 'crm-webhook' },
        observedAt: payload.occurredAt,
        receivedAt: new Date().toISOString(),
        source: 'crm',
      });
    }

    res.status(202).json({ accepted: true });
  }),
);
