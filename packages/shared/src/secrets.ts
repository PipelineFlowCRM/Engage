import { z } from 'zod';

// AWS SES creds shape. Stored encrypted in `Secret` keyed by name='amazon-ses'.
export const amazonSesConfigSchema = z.object({
  region: z.string().min(1).max(40),
  accessKeyId: z.string().min(1).max(255),
  secretAccessKey: z.string().min(1).max(255),
  // The default From domain (must be SES-verified). Used as a fallback
  // when a Template doesn't specify fromEmail.
  defaultFromDomain: z.string().max(255).optional(),
});
export type AmazonSesConfig = z.infer<typeof amazonSesConfigSchema>;

// Generic secret envelope returned by the API (encrypted body never leaves
// the worker — operators only see whether the secret exists, plus a couple
// of safe fields per known-name).
export const secretSetSchema = z.object({
  name: z.string().min(1).max(120),
  value: z.unknown(),                  // shape depends on name; route validates
});
export type SecretSetInput = z.infer<typeof secretSetSchema>;
