import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../env.js';

// Mirror of apps/api/src/lib/crypto.ts. Could be extracted to a shared
// package, but keeping it inlined avoids dragging Node-only deps into
// @pipelineflow-engagement/shared (which is also imported by the web bundle).

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function decodeKey(): Buffer {
  if (!env.SECRET_ENCRYPTION_KEY) {
    throw new Error('SECRET_ENCRYPTION_KEY not configured');
  }
  const buf = Buffer.from(env.SECRET_ENCRYPTION_KEY, 'base64');
  if (buf.length !== 32) {
    throw new Error('SECRET_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return buf;
}

let keyCache: Buffer | null = null;
function getKey(): Buffer {
  if (keyCache) return keyCache;
  keyCache = decodeKey();
  return keyCache;
}

export function encryptString(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptString(envelope: string): string {
  const buf = Buffer.from(envelope, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('Encrypted blob is malformed');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function decryptJson<T = unknown>(envelope: string): T {
  return JSON.parse(decryptString(envelope)) as T;
}
