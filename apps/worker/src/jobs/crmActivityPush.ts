// CRM activity push. POSTs delivery lifecycle events to the CRM as
// HMAC-signed activity entries that land on the corresponding contact's
// timeline. Only fires when CRM_BASE_URL is configured.
//
// Loop prevention: only push for subscribers whose externalId is in the CRM
// namespace (`crm:contact:<id>`). API-only or import-only subscribers
// have no CRM target.

import type { Job } from 'bullmq';
import type { CrmActivityPushJobData } from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { env } from '../env.js';
import { signOutboundCrmRequest } from '../lib/crmAuth.js';

export async function processCrmActivityPush(job: Job<CrmActivityPushJobData>): Promise<void> {
  if (!env.CRM_BASE_URL || !env.CRM_SHARED_SECRET) {
    logger.debug('crm-activity-push: CRM bridge not configured, dropping');
    return;
  }
  const data = job.data;
  const id = BigInt(data.deliveryId);

  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: {
      subscriber: { select: { externalId: true } },
      template: { select: { name: true } },
    },
  });
  if (!delivery) return;

  if (!delivery.subscriber.externalId.startsWith('crm:contact:')) {
    logger.debug(
      { id: id.toString() },
      'crm-activity-push: subscriber is not a CRM contact, skipping',
    );
    return;
  }

  const body = JSON.stringify({
    contactExternalId: delivery.subscriber.externalId,
    event: data.event,
    templateName: delivery.template?.name ?? null,
    subject: delivery.subject ?? null,
    occurredAt: new Date().toISOString(),
  });
  const { signature } = signOutboundCrmRequest(body);

  const url = `${env.CRM_BASE_URL.replace(/\/+$/, '')}/api/public/engagement-activity`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Engagement-Signature': signature,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`CRM activity push failed: ${res.status} ${text.slice(0, 200)}`);
  }
}
