import { Router } from 'express';
import type { Request } from 'express';
import { prisma } from '../../db.js';
import { asyncHandler, HttpError } from '../../lib/error.js';
import { logger } from '../../lib/logger.js';
import { handleSesNotification, validSnsSignature, confirmSubscription } from '../../integrations/ses/sns.js';

import '../_sideEffects.js';

export const sesWebhookRouter = Router();

// Mounted under /api/public/webhooks. Body parsed as raw Buffer (set up at
// the server level) so signature verification has byte-accurate input.
sesWebhookRouter.post(
  '/amazon-ses',
  asyncHandler(async (req: Request, res) => {
    const raw = (req.body as Buffer | undefined)?.toString('utf8');
    if (!raw) throw new HttpError(400, 'Empty webhook body');
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'Webhook body is not JSON');
    }

    // SNS messages have a Type field. Verify signature against AWS's public cert.
    const ok = await validSnsSignature(payload).catch((err: unknown) => {
      logger.warn({ err }, 'sns signature verify failed');
      return false;
    });
    if (!ok) throw new HttpError(401, 'Invalid SNS signature');

    const type = payload['Type'] as string | undefined;
    if (type === 'SubscriptionConfirmation') {
      await confirmSubscription(payload);
      res.status(200).json({ confirmed: true });
      return;
    }
    if (type !== 'Notification') {
      // Bool 'UnsubscribeConfirmation' or future SNS types — log + 200 OK.
      logger.info({ type }, 'sns: ignoring non-Notification message');
      res.status(200).end();
      return;
    }

    await handleSesNotification(payload, prisma);
    res.status(200).end();
  }),
);
