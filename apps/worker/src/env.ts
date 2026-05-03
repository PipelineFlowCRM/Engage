import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6381'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),

  // Crypto — same key as the api so workers can decrypt Secret rows.
  SECRET_ENCRYPTION_KEY: z.string().default(''),
  // Used to mint preferences tokens during outbound send (broadcast worker).
  PREFERENCES_JWT_KEY: z.string().default(''),

  // Public origin (for unsubscribe URLs in rendered emails).
  APP_ORIGIN: z.string().url().default('http://localhost:5174'),

  // CRM bridge (optional)
  CRM_BASE_URL: z.string().default(''),
  CRM_SHARED_SECRET: z.string().default(''),
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;
