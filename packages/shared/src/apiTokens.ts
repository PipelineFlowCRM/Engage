import { z } from 'zod';

// Bearer tokens for /api/public/* (events ingest) and /api/admin/* automation.
// Token format: pfe_<id>_<secret>. We store argon2(secret), not the secret.
export const API_TOKEN_SCOPES = [
  'engagement:ingest',
  'engagement:read',
  'engagement:write',
  'engagement:admin',
] as const;
export type ApiTokenScope = typeof API_TOKEN_SCOPES[number];

export const apiTokenCreateSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1),
  // Optional expiry. Null = never expires (rotate manually).
  expiresAt: z.string().datetime().optional().nullable(),
});
export type ApiTokenCreateInput = z.infer<typeof apiTokenCreateSchema>;
