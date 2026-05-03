// Polls the SES account-level send quota every 60s and writes it to the
// Setting table so the broadcast worker can throttle within AWS limits.

import type { Prisma } from '@prisma/client';
import { GetAccountCommand, getSesClient } from './client.js';
import { prisma } from '../../db.js';
import { logger } from '../../logger.js';

interface SesQuotaSnapshot {
  productionAccessEnabled: boolean;
  sendingEnabled: boolean;
  max24h: number;
  maxSendRate: number; // emails/sec
  sentLast24h: number;
  pollAt: string;
}

export async function pollSesQuota(): Promise<SesQuotaSnapshot | null> {
  const ses = await getSesClient();
  if (!ses) return null;
  const out = await ses.client.send(new GetAccountCommand({}));
  const snapshot: SesQuotaSnapshot = {
    productionAccessEnabled: Boolean(out.ProductionAccessEnabled),
    sendingEnabled: Boolean(out.SendingEnabled),
    max24h: out.SendQuota?.Max24HourSend ?? 0,
    maxSendRate: out.SendQuota?.MaxSendRate ?? 0,
    sentLast24h: out.SendQuota?.SentLast24Hours ?? 0,
    pollAt: new Date().toISOString(),
  };
  // Cast to Prisma.InputJsonValue: our SesQuotaSnapshot is structurally a
  // JSON object, but Prisma's strict input type doesn't accept arbitrary
  // index-less interfaces. Cast at the boundary, not throughout the worker.
  const value = snapshot as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({
    where: { key: 'ses.quota' },
    create: { key: 'ses.quota', value },
    update: { value },
  });
  logger.info(snapshot, 'ses quota updated');
  return snapshot;
}

export async function readSesQuota(): Promise<SesQuotaSnapshot | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'ses.quota' } });
  return (row?.value as unknown as SesQuotaSnapshot) ?? null;
}
