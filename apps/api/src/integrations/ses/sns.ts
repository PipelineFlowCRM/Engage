// Inbound SES → SNS notification handler. Verifies the SNS message
// signature against the AWS-published cert, handles
// SubscriptionConfirmation by GETting the SubscribeURL, and translates
// Notification events (Delivery / Bounce / Complaint / Open / Click /
// Reject) into Delivery row updates keyed by providerMessageId. Hard
// bounces and complaints also write a Suppression row so subsequent
// sends to that address are blocked at snapshot/send time.

import { createVerify } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { enqueueCrmActivityPush } from '../../lib/queue.js';

interface SnsBase {
  Type: string;
  Message: string;
  MessageId: string;
  Timestamp: string;
  TopicArn: string;
  Signature: string;
  SignatureVersion: string;
  SigningCertURL: string;
  SubscribeURL?: string;
}

const certCache = new Map<string, Buffer>();

async function fetchCert(url: string): Promise<Buffer> {
  const cached = certCache.get(url);
  if (cached) return cached;
  // Strict allow-list: AWS SNS certs are served from sns.<region>.amazonaws.com.
  const u = new URL(url);
  if (!u.hostname.endsWith('.amazonaws.com') || !u.hostname.startsWith('sns.')) {
    throw new Error(`SNS cert URL host not allowed: ${u.hostname}`);
  }
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const req = httpsRequest(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
  certCache.set(url, buf);
  return buf;
}

// Build the canonical signing string per the SNS spec.
function canonicalString(msg: SnsBase): string {
  // Notification & SubscriptionConfirmation use different field sets.
  if (msg.Type === 'Notification') {
    const fields = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'];
    return fields
      .map((k) => {
        const v = (msg as unknown as Record<string, string | undefined>)[k];
        return v == null ? null : `${k}\n${v}\n`;
      })
      .filter((s): s is string => s != null)
      .join('');
  }
  if (msg.Type === 'SubscriptionConfirmation' || msg.Type === 'UnsubscribeConfirmation') {
    const m = msg as unknown as Record<string, string | undefined>;
    const fields = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
    return fields
      .map((k) => (m[k] == null ? null : `${k}\n${m[k]}\n`))
      .filter((s): s is string => s != null)
      .join('');
  }
  throw new Error(`Unknown SNS message Type: ${msg.Type}`);
}

export async function validSnsSignature(message: unknown): Promise<boolean> {
  const m = message as SnsBase;
  if (!m.SignatureVersion || (m.SignatureVersion !== '1' && m.SignatureVersion !== '2')) {
    return false;
  }
  if (!m.Signature || !m.SigningCertURL) return false;
  const cert = await fetchCert(m.SigningCertURL);
  const verifier = createVerify(m.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1');
  verifier.update(canonicalString(m), 'utf8');
  return verifier.verify(cert, m.Signature, 'base64');
}

export async function confirmSubscription(message: unknown): Promise<void> {
  const m = message as SnsBase;
  if (!m.SubscribeURL) throw new Error('SubscriptionConfirmation lacks SubscribeURL');
  await new Promise<void>((resolve, reject) => {
    const req = httpsRequest(m.SubscribeURL!, (res) => {
      res.resume();
      res.on('end', () => resolve());
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
  logger.info({ topic: m.TopicArn }, 'confirmed SNS subscription');
}

interface SesNotificationBody {
  notificationType?: string;       // legacy
  eventType?: string;              // SES event publishing v2
  mail?: {
    messageId?: string;
    timestamp?: string;
    destination?: string[];
  };
  bounce?: {
    bounceType?: string;
    bouncedRecipients?: Array<{ emailAddress?: string; diagnosticCode?: string }>;
    timestamp?: string;
  };
  complaint?: {
    complainedRecipients?: Array<{ emailAddress?: string }>;
    timestamp?: string;
    complaintFeedbackType?: string;
  };
  delivery?: { timestamp?: string };
  open?: { timestamp?: string };
  click?: { timestamp?: string; link?: string };
  reject?: { reason?: string };
}

export async function handleSesNotification(
  outer: unknown,
  prisma: PrismaClient,
): Promise<void> {
  const msg = outer as SnsBase;
  let inner: SesNotificationBody;
  try {
    inner = JSON.parse(msg.Message);
  } catch {
    logger.warn({ msgId: msg.MessageId }, 'ses notification body is not JSON');
    return;
  }
  const messageId = inner.mail?.messageId;
  if (!messageId) {
    logger.warn('ses notification missing mail.messageId');
    return;
  }
  // Map SES event → Delivery column. Status precedence (later beats earlier):
  // queued → sent → delivered → opened → clicked
  // Bounced/complained/failed are terminal and override the open/click chain.
  const eventKind = inner.eventType ?? inner.notificationType ?? '';
  const now = new Date();
  const update: Record<string, unknown> = {};
  switch (eventKind) {
    case 'Delivery':
      update['status'] = 'delivered';
      update['deliveredAt'] = now;
      break;
    case 'Bounce':
      update['status'] = 'bounced';
      update['bouncedAt'] = now;
      update['errorMessage'] =
        inner.bounce?.bouncedRecipients?.[0]?.diagnosticCode ?? inner.bounce?.bounceType ?? null;
      // Hard bounce → suppress
      if (inner.bounce?.bounceType === 'Permanent') {
        const email = inner.bounce.bouncedRecipients?.[0]?.emailAddress?.toLowerCase();
        if (email) {
          await prisma.suppression.upsert({
            where: { email },
            create: {
              email,
              reason: 'hard_bounce',
              details: inner.bounce.bouncedRecipients?.[0]?.diagnosticCode ?? null,
            },
            update: { reason: 'hard_bounce' },
          });
        }
      }
      break;
    case 'Complaint': {
      update['status'] = 'complained';
      update['complainedAt'] = now;
      const email = inner.complaint?.complainedRecipients?.[0]?.emailAddress?.toLowerCase();
      if (email) {
        await prisma.suppression.upsert({
          where: { email },
          create: {
            email,
            reason: 'complaint',
            details: inner.complaint?.complaintFeedbackType ?? null,
          },
          update: { reason: 'complaint' },
        });
      }
      break;
    }
    case 'Open':
      update['status'] = 'opened';
      update['openedAt'] = now;
      break;
    case 'Click':
      update['status'] = 'clicked';
      update['clickedAt'] = now;
      break;
    case 'Reject':
      update['status'] = 'failed';
      update['failedAt'] = now;
      update['errorMessage'] = inner.reject?.reason ?? 'rejected';
      break;
    case 'Send':
      // SES has fired this event before our outbound caller commits the
      // Delivery row. We rely on the post-send code path setting sentAt;
      // ignore the SES Send to avoid a race.
      return;
    default:
      logger.info({ eventKind }, 'ses notification: ignored event kind');
      return;
  }

  // Idempotent: if the Delivery row hasn't been written yet (race with our
  // own send-handler tx), updateMany returns 0; the send handler writes
  // the providerMessageId after sending, so we'll catch up on the next
  // notification — SES retries until 200.
  const updated = await prisma.delivery.updateMany({
    where: { providerMessageId: messageId },
    data: update,
  });
  if (updated.count === 0) {
    logger.info({ messageId, eventKind }, 'ses notification: no matching delivery row yet');
    return;
  }

  // Fan out to CRM activity push (Phase 2). Lookup the just-updated row by
  // providerMessageId — we need its id for the queue payload. Skipped
  // automatically by the worker if CRM_BASE_URL isn't configured or the
  // subscriber isn't a CRM contact.
  const eventKindToActivity: Record<string, 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'failed'> = {
    Delivery: 'delivered',
    Open: 'opened',
    Click: 'clicked',
    Bounce: 'bounced',
    Complaint: 'complained',
    Reject: 'failed',
  };
  const activity = eventKindToActivity[eventKind];
  if (!activity) return;
  const row = await prisma.delivery.findUnique({
    where: { providerMessageId: messageId },
    select: { id: true },
  });
  if (!row) return;
  await enqueueCrmActivityPush({
    deliveryId: row.id.toString(),
    event: activity,
  });
}
