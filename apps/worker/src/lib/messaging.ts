// Shared per-message send pipeline. Used by:
//   - broadcastSend (one row out of a snapshot)
//   - journey Message nodes
//
// Idempotency. Every caller passes a stable `idempotencyKey`; we look up
// any existing Delivery with that key BEFORE doing work. The key is also
// written to Delivery.idempotencyKey (UNIQUE), so a job retry that races
// past this short-circuit is caught by the DB. This blocks the
// "BullMQ retries the send job after SES already returned a MessageId"
// double-send hazard.
//
// Outcome semantics:
//   - 'sent'    : SES accepted the message at MessageId X. Safe to record.
//   - 'skipped' : Suppression / unsubscribe / no email / no group. Don't retry.
//   - 'failed'  : SES rejected or our pipeline errored. BullMQ may retry.
//   - 'inflight': A previous attempt with the same key already created a
//                 'queued' Delivery row that never advanced. We don't know
//                 if SES sent. Operator must reconcile manually. NOT retried.

import {
  emailTemplateDefinitionSchema,
  type EmailTemplateDefinition,
} from '@pipelineflow-engagement/shared';
import type { Subscriber, Template, SubscriptionGroup } from '@prisma/client';
import { prisma } from '../db.js';
import { renderEmail } from './render.js';
import { sendMail } from '../integrations/ses/sendMail.js';
import { issuePreferencesToken } from './preferencesJwt.js';
import { enqueueCrmActivityPush } from './queues.js';
import { logger } from '../logger.js';
import { env } from '../env.js';

const SUBJECT_MAX = 998;

export type SendOutcome =
  | { status: 'sent'; deliveryId: bigint; providerMessageId: string }
  | { status: 'skipped'; reason: 'no_email' | 'suppressed' | 'unsubscribed' | 'no_subscription_group' }
  | { status: 'failed'; deliveryId: bigint; error: string }
  // Previous attempt's outcome can't be reconciled; operator action needed.
  | { status: 'inflight'; deliveryId: bigint };

export interface SendTemplateInput {
  templateId: number;
  subscriber: Subscriber;
  // Stable idempotency anchor. Required.
  // Format examples:
  //   broadcasts:   "bd:<broadcastDeliveryId>"
  //   journey msg:  "jr:<journeyRunId>:<nodeId>"
  idempotencyKey: string;
  broadcastId?: number;
  journeyRunId?: bigint;
  extraTags?: Record<string, string>;
}

export async function sendTemplate(input: SendTemplateInput): Promise<SendOutcome> {
  // Idempotency short-circuit. If we've seen this key before, return the
  // existing outcome — never call SES twice for the same key.
  const existing = await prisma.delivery.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (existing.status === 'sent' || existing.status === 'delivered' ||
        existing.status === 'opened' || existing.status === 'clicked') {
      logger.info(
        { idempotencyKey: input.idempotencyKey, deliveryId: existing.id.toString() },
        'sendTemplate: idempotent hit on prior success',
      );
      return {
        status: 'sent',
        deliveryId: existing.id,
        providerMessageId: existing.providerMessageId ?? '',
      };
    }
    if (existing.status === 'queued') {
      // The previous attempt created the row but never advanced. We don't
      // know whether SES received the send. Refuse to retry — sending now
      // could double-send. The Delivery row is the durable evidence;
      // operator can inspect and either mark 'failed' (we'll retry) or
      // accept the orphan.
      logger.warn(
        { idempotencyKey: input.idempotencyKey, deliveryId: existing.id.toString() },
        'sendTemplate: orphaned queued Delivery — refusing retry',
      );
      return { status: 'inflight', deliveryId: existing.id };
    }
    // 'failed' or terminal-bad — fall through and create a fresh attempt.
    // Free up the idempotency key by clearing it on the failed row so the
    // unique insert below succeeds.
    if (existing.status === 'failed' || existing.status === 'bounced' ||
        existing.status === 'complained') {
      await prisma.delivery.update({
        where: { id: existing.id },
        data: { idempotencyKey: null },
      });
    } else {
      // Unknown status — bail conservatively.
      return { status: 'inflight', deliveryId: existing.id };
    }
  }

  const tpl = (await prisma.template.findUnique({
    where: { id: input.templateId },
    include: { subscriptionGroup: true },
  })) as (Template & { subscriptionGroup: SubscriptionGroup | null }) | null;
  if (!tpl) return { status: 'skipped', reason: 'no_subscription_group' };
  if (tpl.subscriptionGroupId == null) return { status: 'skipped', reason: 'no_subscription_group' };
  if (!input.subscriber.email) return { status: 'skipped', reason: 'no_email' };

  const supp = await prisma.suppression.findUnique({
    where: { email: input.subscriber.email.toLowerCase() },
  });
  if (supp) return { status: 'skipped', reason: 'suppressed' };

  const subState = await prisma.subscriptionState.findUnique({
    where: {
      subscriberId_groupId: {
        subscriberId: input.subscriber.id,
        groupId: tpl.subscriptionGroupId,
      },
    },
  });
  if (subState?.status === 'unsubscribed') return { status: 'skipped', reason: 'unsubscribed' };
  if (tpl.subscriptionGroup?.type === 'opt_in' && subState?.status !== 'subscribed') {
    return { status: 'skipped', reason: 'unsubscribed' };
  }

  const definition = emailTemplateDefinitionSchema.parse(tpl.definition) as EmailTemplateDefinition;
  const token = await issuePreferencesToken(input.subscriber.id);
  const preferencesUrl = `${env.APP_ORIGIN}/p/preferences/${token}`;
  const unsubscribeUrl = `${preferencesUrl}/unsubscribe?groupId=${tpl.subscriptionGroupId}`;

  const ctx = {
    subscriber: {
      externalId: input.subscriber.externalId,
      email: input.subscriber.email,
      ...((input.subscriber.traits as object) ?? {}),
    },
    unsubscribe_url: unsubscribeUrl,
    preferences_url: preferencesUrl,
  };
  const rendered = await renderEmail({ ...definition, context: ctx });
  const subject = rendered.subject.slice(0, SUBJECT_MAX);

  // Reserve the idempotency key with a 'queued' Delivery row. UNIQUE on
  // idempotencyKey means a concurrent retry hits P2002 and bails — see
  // catch below. The row also lets the SES webhook handler find this
  // delivery the moment SES posts back.
  let delivery;
  try {
    delivery = await prisma.delivery.create({
      data: {
        subscriberId: input.subscriber.id,
        templateId: tpl.id,
        broadcastId: input.broadcastId ?? null,
        journeyRunId: input.journeyRunId ?? null,
        channel: 'email',
        status: 'queued',
        idempotencyKey: input.idempotencyKey,
        toEmail: input.subscriber.email,
        fromEmail: rendered.fromEmail,
        subject,
        meta: {
          ...(input.broadcastId ? { broadcastId: input.broadcastId } : {}),
          ...(input.journeyRunId ? { journeyRunId: input.journeyRunId.toString() } : {}),
        },
      },
    });
  } catch (err) {
    // P2002: a concurrent retry beat us to inserting. Look up the row it
    // wrote and treat as inflight.
    if (err instanceof Error && (err as Error & { code?: string }).code === 'P2002') {
      const concurrent = await prisma.delivery.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (concurrent) return { status: 'inflight', deliveryId: concurrent.id };
    }
    throw err;
  }

  const tags: Record<string, string> = {
    delivery_id: delivery.id.toString(),
    ...(input.broadcastId ? { broadcast_id: String(input.broadcastId) } : {}),
    ...(input.journeyRunId ? { journey_run_id: input.journeyRunId.toString() } : {}),
    ...(input.extraTags ?? {}),
  };

  try {
    const out = await sendMail({
      toEmail: input.subscriber.email,
      fromEmail: rendered.fromEmail,
      fromName: rendered.fromName,
      replyTo: rendered.replyTo,
      subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:unsubscribe@${rendered.fromEmail.split('@')[1] ?? 'example.com'}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags,
    });
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        providerMessageId: out.providerMessageId,
      },
    });
    await enqueueCrmActivityPush({ deliveryId: delivery.id.toString(), event: 'sent' });
    return { status: 'sent', deliveryId: delivery.id, providerMessageId: out.providerMessageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Mark failed AND clear the idempotency key so the next retry can
    // create a fresh Delivery and try again. Without this, a transient
    // SES outage would leave a permanently-failed key blocking retries.
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        status: 'failed',
        failedAt: new Date(),
        errorMessage: message.slice(0, 4000),
        idempotencyKey: null,
      },
    });
    return { status: 'failed', deliveryId: delivery.id, error: message };
  }
}
