import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../env.js';
import { HttpError } from './error.js';

// AES-256-GCM envelope. Wire format (base64): iv(12) || tag(16) || ciphertext.
// Used by the Secret table to wrap things like SES IAM creds at rest.
//
// Key rotation: support a previous key fallback by setting
// SECRET_ENCRYPTION_KEY_PREVIOUS — the rotator decrypts with previous, then
// re-encrypts with current and writes back. We don't ship a rotator yet;
// just keep the door open in the API surface.

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function decodeKey(b64: string): Buffer {
  if (!b64) {
    throw new HttpError(500, 'SECRET_ENCRYPTION_KEY not configured');
  }
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== 32) {
    throw new HttpError(500, 'SECRET_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return buf;
}

let keyCache: Buffer | null = null;
function getKey(): Buffer {
  if (keyCache) return keyCache;
  keyCache = decodeKey(env.SECRET_ENCRYPTION_KEY);
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
    throw new HttpError(500, 'Encrypted blob is malformed');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function encryptJson(obj: unknown): string {
  return encryptString(JSON.stringify(obj));
}

export function decryptJson<T = unknown>(envelope: string): T {
  return JSON.parse(decryptString(envelope)) as T;
}
