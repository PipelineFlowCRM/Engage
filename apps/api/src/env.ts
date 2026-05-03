import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4100),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6381'),
  APP_ORIGIN: z.string().url().default('http://localhost:5174'),

  // ── Crypto ────────────────────────────────────────────────────────────────
  // 32 raw bytes, base64-encoded. Wraps the Secret table at rest (AES-256-GCM).
  // Required outside development; dev defaults to a fixed string so first-time
  // setup doesn't fail before the operator generates one.
  SECRET_ENCRYPTION_KEY: z.string().default(''),
  // HS256 key for preferences-center JWTs (1y-lived, per-subscriber). Required
  // in production. Optional rotation grace via PREFERENCES_JWT_KEY_PREVIOUS.
  PREFERENCES_JWT_KEY: z.string().default(''),
  PREFERENCES_JWT_KEY_PREVIOUS: z.string().default(''),

  // ── CRM bridge (optional) ────────────────────────────────────────────────
  // Unset → CRM features disabled.
  CRM_BASE_URL: z.string().default(''),
  CRM_SHARED_SECRET: z.string().default(''),

  // ── Auth + flags ────────────────────────────────────────────────────────
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(5 * 60_000),
  SESSION_COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  BULL_BOARD_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  JOBS_TEST_ENDPOINT_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  // ── Event retention (Timescale) ─────────────────────────────────────────
  EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  EVENT_COMPRESSION_AFTER_DAYS: z.coerce.number().int().min(1).max(365).default(7),
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;

// Soft-validate the production-required secrets at boot. Throwing here rather
// than later means the API container restart-loops with a loud error instead
// of accepting traffic and 500-ing on the first send.
export function assertProductionSecrets(): void {
  if (env.NODE_ENV !== 'production') return;
  const missing: string[] = [];
  if (!env.SECRET_ENCRYPTION_KEY) missing.push('SECRET_ENCRYPTION_KEY');
  if (!env.PREFERENCES_JWT_KEY) missing.push('PREFERENCES_JWT_KEY');
  if (missing.length) {
    throw new Error(`Missing required env vars in production: ${missing.join(', ')}`);
  }
}
