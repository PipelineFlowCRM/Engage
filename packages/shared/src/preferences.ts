import { z } from 'zod';

// JWT payload for the public preferences center URL. Signed HS256 with
// PREFERENCES_JWT_KEY (rotation grace via PREFERENCES_JWT_KEY_PREVIOUS).
// Long-lived (1y) by design — every email needs an unsubscribe link, so
// embedding a per-email DB row would explode at scale.
export const preferencesTokenPayloadSchema = z.object({
  sub: z.string().min(1).max(64),       // subscriberId as string
  v: z.literal(1),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
});
export type PreferencesTokenPayload = z.infer<typeof preferencesTokenPayloadSchema>;

// POST body shape for toggling subscriptions.
export const preferencesUpdateSchema = z.object({
  // Map of subscriptionGroupId → desired state. Only listed groups are
  // touched; absent groups retain prior state.
  subscriptions: z.record(
    z.string().regex(/^\d+$/),
    z.enum(['subscribed', 'unsubscribed']),
  ),
});
export type PreferencesUpdateInput = z.infer<typeof preferencesUpdateSchema>;
