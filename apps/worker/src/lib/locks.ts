// Namespaced Postgres advisory locks. Two flavours:
//   1. *withRunLock(runId, fn)*: acquire a transaction-level lock for the
//      duration of `fn`. Released automatically on tx commit/rollback so a
//      worker crash doesn't leave a stuck lock — fixes the session-level
//      lock issue that bit `audienceCompute` previously.
//   2. *withSubscriberLock(externalId, fn)*: same, scoped to event-ingest.
//
// Postgres advisory locks come in (int8) and (int4, int4) forms. The
// two-int form gives us a *namespace* — important because otherwise the
// 32-bit hash space can collide between, e.g., a Subscriber externalId
// and an audienceId. We use a fixed namespace constant per usage site.

import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db.js';

// Namespace tags. Unique per call site so a hash collision in one
// domain (subscribers) can never block work in another (runs / audiences).
export const LOCK_NS = {
  journeyRun: 1,
  audience: 2,
  subscriber: 3,
} as const;

// Hash a string to a 32-bit signed int for Postgres int4. We use the
// stable `hashtext()` SQL function so the hashing is server-side and
// matches whatever future SQL we write.
async function tryLockTx(
  tx: Prisma.TransactionClient,
  ns: number,
  key: string | number,
): Promise<boolean> {
  const keyStr = String(key);
  const rows = await tx.$queryRaw<Array<{ ok: boolean }>>`
    SELECT pg_try_advisory_xact_lock(${ns}::int4, hashtext(${keyStr})::int4) AS ok
  `;
  return rows[0]?.ok === true;
}

/**
 * Run `fn` inside a transaction with an advisory lock on (ns, key). If the
 * lock can't be acquired (another worker has it), returns null without
 * running `fn`. Caller treats null as "skip — already in progress".
 */
export async function withAdvisoryLock<T>(
  ns: number,
  key: string | number,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  // Default Prisma interactive-tx timeout is 5s — too short for the
  // journey tick (which calls SES inside). Callers can lengthen.
  options: { timeoutMs?: number; maxWaitMs?: number } = {},
): Promise<T | null> {
  return prisma.$transaction(async (tx) => {
    const ok = await tryLockTx(tx, ns, key);
    if (!ok) return null;
    return fn(tx);
  }, {
    maxWait: options.maxWaitMs ?? 5_000,
    timeout: options.timeoutMs ?? 30_000,
  });
}

/**
 * Run `fn` inside a transaction with a *blocking* advisory lock. Used
 * when the caller wants to wait its turn rather than skip. Should be used
 * sparingly — long-held blocking locks can pile up under load.
 */
export async function withBlockingAdvisoryLock<T>(
  ns: number,
  key: string | number,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const keyStr = String(key);
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(${ns}::int4, hashtext(${keyStr})::int4)
    `;
    return fn(tx);
  });
}

// Helper: acquire a session-level lock on a base PrismaClient. Used only
// where we genuinely need the lock to span multiple transactions (rare).
// Caller MUST release via releaseSessionLock to avoid leaking.
export async function trySessionLock(
  client: PrismaClient,
  ns: number,
  key: string | number,
): Promise<boolean> {
  const keyStr = String(key);
  const rows = await client.$queryRaw<Array<{ ok: boolean }>>`
    SELECT pg_try_advisory_lock(${ns}::int4, hashtext(${keyStr})::int4) AS ok
  `;
  return rows[0]?.ok === true;
}

export async function releaseSessionLock(
  client: PrismaClient,
  ns: number,
  key: string | number,
): Promise<void> {
  const keyStr = String(key);
  await client.$queryRaw`
    SELECT pg_advisory_unlock(${ns}::int4, hashtext(${keyStr})::int4)
  `;
}
