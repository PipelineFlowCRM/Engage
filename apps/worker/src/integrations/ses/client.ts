// Cached SES client per region. Loads creds from the encrypted Secret table
// at first use; rotates by restarting the worker (which clears the cache).

import {
  SESv2Client,
  SendEmailCommand,
  GetAccountCommand,
} from '@aws-sdk/client-sesv2';
import { prisma } from '../../db.js';
import { decryptJson } from '../../lib/crypto.js';
import { logger } from '../../logger.js';
import type { AmazonSesConfig } from '@pipelineflow-engagement/shared';

let cached: { client: SESv2Client; config: AmazonSesConfig } | null = null;

export async function loadSesConfig(): Promise<AmazonSesConfig | null> {
  const row = await prisma.secret.findUnique({ where: { name: 'amazon-ses' } });
  if (!row) return null;
  try {
    return decryptJson<AmazonSesConfig>(row.encrypted);
  } catch (err) {
    logger.error({ err }, 'failed to decrypt amazon-ses secret');
    return null;
  }
}

export async function getSesClient(): Promise<{ client: SESv2Client; config: AmazonSesConfig } | null> {
  if (cached) return cached;
  const config = await loadSesConfig();
  if (!config) return null;
  const client = new SESv2Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cached = { client, config };
  return cached;
}

export function invalidateSesCache(): void {
  cached = null;
}

export { SendEmailCommand, GetAccountCommand };
