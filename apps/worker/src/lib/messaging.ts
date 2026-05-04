// Shared per-message send pipeline. Used by:
//   - broadcastSend (one row out of a snapshot)
//   - journey Message nodes
//
// Responsibilities:
//   1. Load the Template + subscription group.
//   2. Defense-in-depth: re-check Suppression + SubscriptionState.
//   3. Mint per-subscriber preferences token + unsubscribe URL.
//   4. Render MJML + Liquid.
//   5. Insert Delivery row in 'queued', send via SES, update to 'sent' with
//      providerMessageId — atomically as far as the row state is concerned.
//   6. Return a typed outcome for the caller to update its own row
//      (BroadcastDelivery for broadcasts, JourneyRunStep for journeys).

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
import { env } from '../env.js';

const SUBJECT_MAX = 998;

export type SendOutcome =
  | { status: 'sent'; deliveryId: bigint; providerMessageId: string }
  | { status: 'skipped'; reason: 'no_email' | 'suppressed' | 'unsubscribed' | 'no_subscription_group' }
  | { status: 'failed'; deliveryId: bigint; error: string };

export interface SendTemplateInput {
  templateId: number;
  subscriber: Subscriber;
  // For attribution on the Delivery row + SES MessageTags. Pass whichever
  // applies; both can be present (a journey Message can also be tagged
  // with a parent broadcast id if it came in through one).
  broadcastId?: number;
  journeyRunId?: bigint;
  // Extra SES MessageTags. Merged with auto-generated delivery_id /
  // broadcast_id / journey_run_id tags.
  extraTags?: Record<string, string>;
}

export async function sendTemplate(input: SendTemplateInput): Promise<SendOutcome> {
  const tpl = (await prisma.template.findUnique({
    where: { id: input.templateId },
    include: { subscriptionGroup: true },
  })) as (Template & { subscriptionGroup: SubscriptionGroup | null }) | null;
  if (!tpl) {
    return { status: 'skipped', reason: 'no_subscription_group' };
  }
  if (tpl.subscriptionGroupId == null) {
    return { status: 'skipped', reason: 'no_subscription_group' };
  }

  if (!input.subscriber.email) {
    return { status: 'skipped', reason: 'no_email' };
  }
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
  if (subState?.status === 'unsubscribed') {
    return { status: 'skipped', reason: 'unsubscribed' };
  }
  // For opt_in groups, absence of state == not subscribed → skip.
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

  // Pre-write Delivery row in 'queued' so SES webhooks can find it the moment
  // SES posts back. We update with the providerMessageId after the send call.
  const delivery = await prisma.delivery.create({
    data: {
      subscriberId: input.subscriber.id,
      templateId: tpl.id,
      broadcastId: input.broadcastId ?? null,
      journeyRunId: input.journeyRunId ?? null,
      channel: 'email',
      status: 'queued',
      toEmail: input.subscriber.email,
      fromEmail: rendered.fromEmail,
      subject,
      meta: {
        ...(input.broadcastId ? { broadcastId: input.broadcastId } : {}),
        ...(input.journeyRunId ? { journeyRunId: input.journeyRunId.toString() } : {}),
      },
    },
  });

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
        // Both formats — RFC 8058 one-click + classic mailto fallback.
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
    // CRM activity push for the 'sent' lifecycle event. The CRM-side worker
    // filters non-CRM subscribers (externalId not 'crm:contact:*'). Other
    // lifecycle events (delivered/opened/etc) fan out from the SNS handler
    // when SES posts back, so we don't enqueue them here.
    await enqueueCrmActivityPush({ deliveryId: delivery.id.toString(), event: 'sent' });
    return { status: 'sent', deliveryId: delivery.id, providerMessageId: out.providerMessageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        status: 'failed',
        failedAt: new Date(),
        errorMessage: message.slice(0, 4000),
      },
    });
    return { status: 'failed', deliveryId: delivery.id, error: message };
  }
}
