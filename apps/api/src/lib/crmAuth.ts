import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Request } from 'express';
import { ssoTokenPayloadSchema, type SsoTokenPayload } from '@pipelineflow-engagement/shared';
import { env } from '../env.js';
import { HttpError } from './error.js';

const SSO_ALG = 'HS256';
const SSO_ISSUER = 'pipelineflow-crm';
const SSO_AUDIENCE = 'pipelineflow-engagement';
const SIGNATURE_HEADER = 'x-engagement-signature';

function getCrmSecret(): Uint8Array {
  if (!env.CRM_SHARED_SECRET) {
    throw new HttpError(500, 'CRM_SHARED_SECRET not configured');
  }
  return new TextEncoder().encode(env.CRM_SHARED_SECRET);
}

/**
 * Verify HMAC-SHA256 of the raw request body matches the signature header.
 * The CRM signs `<timestamp>.<body>` to make replay obvious; we reject any
 * timestamp older than 5 minutes.
 */
export function verifyCrmWebhookSignature(req: Request, rawBody: Buffer): void {
  const sig = req.get(SIGNATURE_HEADER);
  if (!sig) throw new HttpError(401, 'Missing webhook signature');
  // Wire format: t=<unix>,v1=<hex>
  const parts = Object.fromEntries(
    sig.split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k?.trim() ?? '', v?.trim() ?? ''];
    }),
  );
  const ts = parts['t'];
  const v1 = parts['v1'];
  if (!ts || !v1) throw new HttpError(401, 'Malformed webhook signature');
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) throw new HttpError(401, 'Invalid signature timestamp');
  const ageS = Math.abs(Date.now() / 1000 - tsNum);
  if (ageS > 5 * 60) throw new HttpError(401, 'Signature timestamp too old');

  const mac = createHmac('sha256', env.CRM_SHARED_SECRET);
  mac.update(`${ts}.`);
  mac.update(rawBody);
  const expected = mac.digest();
  const provided = Buffer.from(v1, 'hex');
  if (provided.length !== expected.length) {
    throw new HttpError(401, 'Bad signature');
  }
  if (!timingSafeEqual(provided, expected)) {
    throw new HttpError(401, 'Bad signature');
  }
}

/** Compute the signature header for outbound CRM activity push. */
export function signOutboundCrmRequest(rawBody: string): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const mac = createHmac('sha256', env.CRM_SHARED_SECRET);
  mac.update(`${ts}.`);
  mac.update(rawBody);
  return `t=${ts},v1=${mac.digest('hex')}`;
}

/** Verify a CRM-issued SSO JWT. Returns the payload on success. */
export async function verifySsoToken(token: string): Promise<SsoTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, getCrmSecret(), {
      issuer: SSO_ISSUER,
      audience: SSO_AUDIENCE,
      algorithms: [SSO_ALG],
    });
    return ssoTokenPayloadSchema.parse({
      iss: payload.iss,
      sub: payload.sub,
      name: payload['name'],
      iat: payload.iat,
      exp: payload.exp,
    });
  } catch {
    throw new HttpError(401, 'Invalid SSO token');
  }
}

/**
 * For testing / dev: mint a CRM-shaped SSO JWT. In real deployments this is
 * minted by the CRM itself; we only need this helper for the seed user flow
 * and integration tests.
 */
export async function mintTestSsoToken(email: string, name: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ name })
    .setProtectedHeader({ alg: SSO_ALG })
    .setIssuer(SSO_ISSUER)
    .setAudience(SSO_AUDIENCE)
    .setSubject(email)
    .setIssuedAt(now)
    .setExpirationTime(now + 15 * 60)
    .sign(getCrmSecret());
}
