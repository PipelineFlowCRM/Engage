// Postgres transaction-level advisory locks for the API. Mirrors the
// worker's lib/locks.ts but lives here so the API can serialize concurrent
// writes (e.g. save-draft vs publish) without depending on the worker
// package. Locks are released automatically on tx commit/rollback so a
// crashed request can't leave a stuck lock.
//
// Use blocking locks for short, well-bounded critical sections — write
// paths inside a single request — so concurrent callers wait their turn
// rather than 500'ing on a unique-constraint violation.

import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

// Namespace tags. Each domain gets its own int4 so hashtext() collisions
// in one namespace can't block work in another.
export const LOCK_NS = {
  journey: 10,
} as const;

export async function withBlockingAdvisoryLock<T>(
  ns: number,
  key: string | number,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { timeoutMs?: number; maxWaitMs?: number } = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const keyStr = String(key);
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(${ns}::int4, hashtext(${keyStr})::int4)
      `;
      return fn(tx);
    },
    {
      maxWait: options.maxWaitMs ?? 5_000,
      timeout: options.timeoutMs ?? 15_000,
    },
  );
}
