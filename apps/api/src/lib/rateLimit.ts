import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { env } from '../env.js';

// We use the in-memory MemoryStore for now; for multi-instance api deploys
// the Redis-backed `rate-limit-redis` adapter is the right choice but
// adds a dependency we don't want in Phase-1-equivalent surface area.
// Tracked under future work.

// Login: per-IP brute force defense. Tunable via env. Defaults to
// 10 attempts / 5 minutes.
export const loginLimiter: RequestHandler = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_LOGIN_MAX,
  message: { error: 'Too many login attempts; try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Preferences-center mutations (token-gated, but a leaked token + a
// script could otherwise flip subscriptions thousands of times).
export const preferencesLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 30,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public ingest (Bearer-authenticated). Per-IP cap is the safety net; the
// per-token limit is more important and lives at the queue depth check
// (deferred). A 60-req-per-second IP burst will pass through to the
// ingest queue, which is fine for normal traffic.
export const ingestLimiter: RequestHandler = rateLimit({
  windowMs: 1_000,
  limit: 60,
  message: { error: 'Ingest rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip the IP check entirely if no Authorization header is present —
  // the Bearer auth middleware will reject those anyway and the limiter
  // shouldn't burn its budget on rejected requests.
  skip: (req) => !req.get('authorization'),
});
