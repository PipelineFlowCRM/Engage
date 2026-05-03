import { SignJWT } from 'jose';
import { env } from '../env.js';

const ALG = 'HS256';
const ISSUER = 'pipelineflow-engagement';
const AUDIENCE = 'preferences';
const ONE_YEAR_S = 365 * 24 * 60 * 60;

let keyCache: Uint8Array | null = null;
function getKey(): Uint8Array {
  if (keyCache) return keyCache;
  if (!env.PREFERENCES_JWT_KEY) {
    throw new Error('PREFERENCES_JWT_KEY not configured');
  }
  keyCache = new TextEncoder().encode(env.PREFERENCES_JWT_KEY);
  return keyCache;
}

export async function issuePreferencesToken(subscriberId: bigint): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ v: 1 })
    .setProtectedHeader({ alg: ALG })
    .setSubject(subscriberId.toString())
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ONE_YEAR_S)
    .sign(getKey());
}
