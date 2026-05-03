import type { Request } from 'express';
import { prisma } from '../db.js';
import { logger } from './logger.js';

// Truncate the meta blob to ~4KB so audit storage doesn't grow unbounded
// when a route stuffs an entire payload through. Truncation is silent —
// it's an audit log, not the source of truth.
const META_LIMIT = 4_096;

function truncate(meta: unknown): unknown {
  const json = JSON.stringify(meta);
  if (json.length <= META_LIMIT) return meta;
  return { _truncated: true, preview: json.slice(0, META_LIMIT) };
}

export async function audit(
  req: Request,
  action: string,
  target: string | null,
  meta?: unknown,
): Promise<void> {
  try {
    await prisma.operatorAuditEvent.create({
      data: {
        userId: req.user?.id ?? null,
        action,
        target,
        meta: meta == null ? {} : (truncate(meta) as object),
      },
    });
  } catch (err) {
    logger.warn({ err, action, target }, 'failed to write audit event');
  }
}
