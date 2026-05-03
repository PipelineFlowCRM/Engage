import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { preferencesTokenPayloadSchema } from '@pipelineflow-engagement/shared';
import type { PreferencesTokenPayload } from '@pipelineflow-engagement/shared';
import { env } from '../env.js';
import { HttpError } from './error.js';

const ALG = 'HS256';
const ISSUER = 'pipelineflow-engagement';
const AUDIENCE = 'preferences';

function keyFromEnv(value: string): Uint8Array {
  if (!value) {
    throw new HttpError(500, 'PREFERENCES_JWT_KEY not configured');
  }
  return new TextEncoder().encode(value);
}

let primary: Uint8Array | null = null;
function getPrimaryKey(): Uint8Array {
  if (!primary) primary = keyFromEnv(env.PREFERENCES_JWT_KEY);
  return primary;
}
function getPreviousKey(): Uint8Array | null {
  return env.PREFERENCES_JWT_KEY_PREVIOUS
    ? new TextEncoder().encode(env.PREFERENCES_JWT_KEY_PREVIOUS)
    : null;
}

const ONE_YEAR_S = 365 * 24 * 60 * 60;

export async function issuePreferencesToken(subscriberId: bigint | string): Promise<string> {
  const sub = typeof subscriberId === 'bigint' ? subscriberId.toString() : subscriberId;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ v: 1 })
    .setProtectedHeader({ alg: ALG })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ONE_YEAR_S)
    .sign(getPrimaryKey());
}

/**
 * Verify a preferences token. Tries the primary key first, then the
 * previous-key fallback so a key rotation has a grace window where
 * already-issued links keep working.
 */
export async function verifyPreferencesToken(token: string): Promise<PreferencesTokenPayload> {
  const tryKey = async (key: Uint8Array) => {
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALG],
    });
    return preferencesTokenPayloadSchema.parse({
      sub: payload.sub,
      v: payload['v'],
      iat: payload.iat,
      exp: payload.exp,
    });
  };
  try {
    return await tryKey(getPrimaryKey());
  } catch (err) {
    const prev = getPreviousKey();
    if (prev && err instanceof joseErrors.JWSSignatureVerificationFailed) {
      try {
        return await tryKey(prev);
      } catch {
        /* fall through */
      }
    }
    throw new HttpError(401, 'Invalid or expired preferences token');
  }
}
