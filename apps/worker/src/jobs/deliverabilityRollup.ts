// Deliverability rollup. Hourly recurring job. Counts deliveries / bounces
// / complaints in the last 24h, computes rates, raises or resolves
// DeliverabilityAlert rows, and writes a snapshot to Setting for the
// dashboard.
//
// AWS thresholds (the line in the sand):
//   - Complaint rate > 0.1% sustained → SES auto-pauses sending.
//   - Bounce rate > 5% sustained → SES auto-pauses sending.
// We alert at lower warning thresholds first, then at the hard threshold.

import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../logger.js';

export const COMPLAINT_RATE_WARNING = 0.0005;     // 0.05%
export const COMPLAINT_RATE_CRITICAL = 0.001;     // 0.1%
export const BOUNCE_RATE_WARNING = 0.03;          // 3%
export const BOUNCE_RATE_CRITICAL = 0.05;         // 5%
// Below this many deliveries we don't alert — small samples are noisy.
const MIN_SAMPLE = 100;

interface Snapshot {
  windowHours: 24;
  asOf: string;
  totalSent: number;
  totalDelivered: number;
  totalBounced: number;
  totalComplained: number;
  bounceRate: number;       // 0..1
  complaintRate: number;    // 0..1
}

export async function processDeliverabilityRollup(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Aggregate counts. We use one groupBy for status counts in the window.
  // 'sent' / 'delivered' / 'opened' / 'clicked' all imply a successful send;
  // bounced and complained are terminal failures. Status precedence (later
  // beats earlier) means a 'sent' row that later 'opened' will count as
  // 'opened' here — that's fine, it's still a successful delivery for
  // rate-denominator purposes.
  const groups = await prisma.delivery.groupBy({
    by: ['status'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  for (const g of groups) counts[g.status] = g._count._all;

  const totalSent =
    (counts['sent'] ?? 0) + (counts['delivered'] ?? 0) +
    (counts['opened'] ?? 0) + (counts['clicked'] ?? 0) +
    (counts['bounced'] ?? 0) + (counts['complained'] ?? 0) +
    (counts['unsubscribed'] ?? 0);
  const totalDelivered = totalSent - (counts['bounced'] ?? 0) - (counts['failed'] ?? 0);
  const totalBounced = counts['bounced'] ?? 0;
  const totalComplained = counts['complained'] ?? 0;

  const bounceRate = totalSent > 0 ? totalBounced / totalSent : 0;
  const complaintRate = totalSent > 0 ? totalComplained / totalSent : 0;

  const snapshot: Snapshot = {
    windowHours: 24,
    asOf: new Date().toISOString(),
    totalSent,
    totalDelivered,
    totalBounced,
    totalComplained,
    bounceRate,
    complaintRate,
  };

  await prisma.setting.upsert({
    where: { key: 'deliverability.snapshot' },
    create: { key: 'deliverability.snapshot', value: snapshot as unknown as Prisma.InputJsonValue },
    update: { value: snapshot as unknown as Prisma.InputJsonValue },
  });

  // Skip alerting on small samples — the rates would be noisy.
  if (totalSent < MIN_SAMPLE) {
    logger.debug({ totalSent }, 'deliverability rollup: sample too small for alerts');
    return;
  }

  await reconcileAlert(
    'complaint_rate',
    complaintRate,
    COMPLAINT_RATE_CRITICAL,
    COMPLAINT_RATE_WARNING,
    snapshot,
  );
  await reconcileAlert(
    'bounce_rate',
    bounceRate,
    BOUNCE_RATE_CRITICAL,
    BOUNCE_RATE_WARNING,
    snapshot,
  );
}

// Idempotent alert raise/resolve. If an unresolved alert exists for the
// kind, we either keep it (and bump its severity) or resolve it. Otherwise
// we create a new one when the metric crosses warning/critical.
async function reconcileAlert(
  kind: 'complaint_rate' | 'bounce_rate',
  rate: number,
  critical: number,
  warning: number,
  snapshot: Snapshot,
): Promise<void> {
  const existing = await prisma.deliverabilityAlert.findFirst({
    where: { kind, resolvedAt: null },
    orderBy: { triggeredAt: 'desc' },
  });

  const desiredSeverity: 'critical' | 'warning' | null =
    rate >= critical ? 'critical' :
    rate >= warning ? 'warning' :
    null;

  if (!desiredSeverity) {
    if (existing) {
      await prisma.deliverabilityAlert.update({
        where: { id: existing.id },
        data: { resolvedAt: new Date() },
      });
      logger.info({ kind, rate }, 'deliverability alert resolved');
    }
    return;
  }

  if (!existing) {
    await prisma.deliverabilityAlert.create({
      data: {
        kind,
        severity: desiredSeverity,
        meta: { rate, threshold: desiredSeverity === 'critical' ? critical : warning, snapshot } as unknown as Prisma.InputJsonValue,
      },
    });
    logger.warn({ kind, severity: desiredSeverity, rate }, 'deliverability alert raised');
    return;
  }

  // Severity drift: warning → critical (or back). Just update; don't raise
  // a fresh alert row so the dashboard's count of unresolved alerts stays
  // sane.
  if (existing.severity !== desiredSeverity) {
    await prisma.deliverabilityAlert.update({
      where: { id: existing.id },
      data: {
        severity: desiredSeverity,
        meta: { rate, threshold: desiredSeverity === 'critical' ? critical : warning, snapshot } as unknown as Prisma.InputJsonValue,
      },
    });
    logger.warn({ kind, from: existing.severity, to: desiredSeverity }, 'deliverability alert severity changed');
  }
}
