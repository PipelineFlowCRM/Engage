import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { ApiToken, AuthUser } from '@prisma/client';
import { API_TOKEN_SCOPES, type ApiTokenScope } from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';

// Wire format: pfe_<id>.<secret>. `pfe_` makes the prefix grep-recognisable
// and distinct from PipelineFlow CRM's `pf_` so a leak can be triaged to the
// right system. Token id is `tok_` + base64url; secret is base64url.
export const TOKEN_PREFIX = 'pfe_';
const SEPARATOR = '.';
const ID_BYTES = 10;
const SECRET_BYTES = 32;

export function isValidScope(s: string): s is ApiTokenScope {
  return (API_TOKEN_SCOPES as readonly string[]).includes(s);
}

export function newTokenId(): string {
  return `tok_${randomBytes(ID_BYTES).toString('base64url')}`;
}
export function newTokenSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}
export function formatToken(id: string, secret: string): string {
  return `${TOKEN_PREFIX}${id}${SEPARATOR}${secret}`;
}
export function parseToken(raw: string): { id: string; secret: string } | null {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const body = raw.slice(TOKEN_PREFIX.length);
  const sep = body.indexOf(SEPARATOR);
  if (sep === -1) return null;
  const id = body.slice(0, sep);
  const secret = body.slice(sep + 1);
  if (!id.startsWith('tok_') || !secret) return null;
  return { id, secret };
}
export const hashTokenSecret = (plain: string) =>
  argon2.hash(plain, { type: argon2.argon2id });

export type LoadedApiToken = ApiToken & { user: AuthUser };

let dummyArgon2HashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyArgon2HashPromise) {
    dummyArgon2HashPromise = argon2.hash(randomBytes(32).toString('base64url'), {
      type: argon2.argon2id,
    });
  }
  return dummyArgon2HashPromise;
}

export async function authenticateApiToken(raw: string): Promise<LoadedApiToken | null> {
  const parsed = parseToken(raw);
  if (!parsed) return null;
  const row = await prisma.apiToken.findUnique({
    where: { id: parsed.id },
    include: { user: true },
  });
  if (!row) {
    const dummy = await getDummyHash();
    await argon2.verify(dummy, parsed.secret).catch(() => false);
    return null;
  }
  let ok: boolean;
  try {
    ok = await argon2.verify(row.secretHash, parsed.secret);
  } catch {
    return null;
  }
  if (!ok) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt < new Date()) return null;
  return row;
}

export function tokenScopes(t: ApiToken): ApiTokenScope[] {
  if (!Array.isArray(t.scopes)) return [];
  return (t.scopes as unknown[]).filter(
    (s): s is ApiTokenScope => typeof s === 'string' && isValidScope(s),
  );
}

export function tokenHasScope(t: ApiToken, scope: ApiTokenScope): boolean {
  return tokenScopes(t).includes(scope);
}

const LAST_USED_DEBOUNCE_MS = 60_000;
export async function touchLastUsed(token: ApiToken): Promise<void> {
  const now = Date.now();
  if (token.lastUsedAt && now - token.lastUsedAt.getTime() < LAST_USED_DEBOUNCE_MS) return;
  await prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date(now) } })
    .catch(() => undefined);
}
