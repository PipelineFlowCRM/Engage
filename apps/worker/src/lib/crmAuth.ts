import { createHmac } from 'node:crypto';
import { env } from '../env.js';

// Outbound CRM signature. Mirrors apps/api/src/lib/crmAuth.ts shape:
// header `X-Engagement-Signature: t=<unix>,v1=<hex>` over `<unix>.<rawBody>`.
export function signOutboundCrmRequest(rawBody: string): { ts: string; signature: string } {
  if (!env.CRM_SHARED_SECRET) {
    throw new Error('CRM_SHARED_SECRET not configured');
  }
  const ts = Math.floor(Date.now() / 1000).toString();
  const mac = createHmac('sha256', env.CRM_SHARED_SECRET);
  mac.update(`${ts}.`);
  mac.update(rawBody);
  return { ts, signature: `t=${ts},v1=${mac.digest('hex')}` };
}
