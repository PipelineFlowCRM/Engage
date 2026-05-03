// Per-send worker. Renders the template, sends via SES, writes the
// Delivery row + flips BroadcastDelivery to 'sent'/'failed'.
//
// Defense-in-depth: re-checks Suppression and SubscriptionState even though
// snapshotting filtered them — they may have flipped between snapshot and
// send (an opener-time unsubscribe, an SES bounce that suppressed mid-batch).

import type { Job } from 'bullmq';
import type { BroadcastSendJobData } from '@pipelineflow-engagement/shared';
import {
  emailTemplateDefinitionSchema,
  type EmailTemplateDefinition,
} from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { renderEmail } from '../lib/render.js';
import { sendMail } from '../integrations/ses/sendMail.js';
import { issuePreferencesToken } from '../lib/preferencesJwt.js';
import { env } from '../env.js';

const SUBJECT_MAX = 998;

export async function processBroadcastSend(job: Job<BroadcastSendJobData>) {
  const id = BigInt(job.data.broadcastDeliveryId);

  const bd = await prisma.broadcastDelivery.findUnique({
    where: { id },
    include: {
      broadcast: {
        include: {
          template: { include: { subscriptionGroup: true } },
        },
      },
    },
  });
  if (!bd) {
    logger.warn({ id: id.toString() }, 'broadcast send: row missing');
    return;
  }
  if (bd.status !== 'pending') {
    logger.debug({ id: id.toString(), status: bd.status }, 'broadcast send: row not pending');
    return;
  }
  if (bd.broadcast.status === 'paused' || bd.broadcast.status === 'cancelled') {
    return;
  }
  const tpl = bd.broadcast.template;
  if (tpl.subscriptionGroupId == null) {
    await markFailed(id, 'Template has no subscription group');
    return;
  }

  const subscriber = await prisma.subscriber.findUnique({ where: { id: bd.subscriberId } });
  if (!subscriber || !subscriber.email) {
    await markSkipped(id, 'no_email');
    return;
  }
  // Re-check suppression
  const supp = await prisma.suppression.findUnique({
    where: { email: subscriber.email.toLowerCase() },
  });
  if (supp) {
    await markSkipped(id, 'suppressed');
    return;
  }
  // Re-check subscription state
  const sub = await prisma.subscriptionState.findUnique({
    where: {
      subscriberId_groupId: { subscriberId: subscriber.id, groupId: tpl.subscriptionGroupId },
    },
  });
  if (sub?.status === 'unsubscribed') {
    await markSkipped(id, 'unsubscribed');
    return;
  }

  const definition = emailTemplateDefinitionSchema.parse(tpl.definition) as EmailTemplateDefinition;

  // Mint a per-subscriber preferences token and inject the unsubscribe URL.
  const token = await issuePreferencesToken(subscriber.id);
  const preferencesUrl = `${env.APP_ORIGIN}/p/preferences/${token}`;
  const unsubscribeUrl = `${preferencesUrl}/unsubscribe?groupId=${tpl.subscriptionGroupId}`;

  const ctx = {
    subscriber: {
      externalId: subscriber.externalId,
      email: subscriber.email,
      ...((subscriber.traits as object) ?? {}),
    },
    unsubscribe_url: unsubscribeUrl,
    preferences_url: preferencesUrl,
  };
  const rendered = await renderEmail({ ...definition, context: ctx });

  // Truncate subject — SES rejects > 998 chars.
  const subject = rendered.subject.slice(0, SUBJECT_MAX);

  // Pre-write the Delivery row in 'queued' so the SES webhook can find it
  // by providerMessageId once the send returns. We update with the
  // providerMessageId post-send.
  const delivery = await prisma.delivery.create({
    data: {
      subscriberId: subscriber.id,
      templateId: tpl.id,
      broadcastId: bd.broadcastId,
      channel: 'email',
      status: 'queued',
      toEmail: subscriber.email,
      fromEmail: rendered.fromEmail,
      subject,
      meta: { broadcastDeliveryId: id.toString() },
    },
  });

  try {
    const out = await sendMail({
      toEmail: subscriber.email,
      fromEmail: rendered.fromEmail,
      fromName: rendered.fromName,
      replyTo: rendered.replyTo,
      subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:unsubscribe@${rendered.fromEmail.split('@')[1]}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: {
        delivery_id: delivery.id.toString(),
        broadcast_id: String(bd.broadcastId),
      },
    });
    await prisma.$transaction([
      prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          providerMessageId: out.providerMessageId,
        },
      }),
      prisma.broadcastDelivery.update({
        where: { id },
        data: { status: 'sent', deliveryId: delivery.id },
      }),
      prisma.broadcast.update({
        where: { id: bd.broadcastId },
        data: { sentCount: { increment: 1 } },
      }),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.$transaction([
      prisma.delivery.update({
        where: { id: delivery.id },
        data: { status: 'failed', failedAt: new Date(), errorMessage: message.slice(0, 4000) },
      }),
      prisma.broadcastDelivery.update({
        where: { id },
        data: {
          attemptCount: { increment: 1 },
          lastError: message.slice(0, 4000),
          // Leave status='pending' so BullMQ retry replays this job — it'll
          // create a new Delivery row each time. Hard fail after the BullMQ
          // attempt budget is exhausted; the Worker's `failed` listener
          // marks BroadcastDelivery 'failed' there.
        },
      }),
    ]);
    throw err;
  }

  // Check if this was the last pending row for this broadcast — flip to completed.
  const stillPending = await prisma.broadcastDelivery.count({
    where: { broadcastId: bd.broadcastId, status: 'pending' },
  });
  if (stillPending === 0) {
    await prisma.broadcast.updateMany({
      where: { id: bd.broadcastId, status: 'running' },
      data: { status: 'completed', completedAt: new Date() },
    });
  }
}

async function markSkipped(id: bigint, reason: string) {
  await prisma.broadcastDelivery.update({
    where: { id },
    data: { status: 'skipped', skipReason: reason },
  });
  await prisma.broadcast.update({
    where: { id: (await prisma.broadcastDelivery.findUnique({ where: { id } }))!.broadcastId },
    data: { skippedCount: { increment: 1 } },
  });
}
async function markFailed(id: bigint, error: string) {
  const bd = await prisma.broadcastDelivery.update({
    where: { id },
    data: { status: 'failed', lastError: error.slice(0, 4000) },
  });
  await prisma.broadcast.update({
    where: { id: bd.broadcastId },
    data: { failedCount: { increment: 1 } },
  });
}
