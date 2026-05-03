import type { Request, RequestHandler } from 'express';
import type { ApiToken, AuthUser } from '@prisma/client';
import type { ApiTokenScope } from '@pipelineflow-engagement/shared';
import { HttpError } from '../lib/error.js';
import { env } from '../env.js';
import { SESSION_COOKIE_NAME, loadSession } from './sessions.js';
import { authenticateApiToken, tokenHasScope, touchLastUsed } from './apiToken.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
      apiToken?: ApiToken;
    }
  }
}

/** Origin/Referer check — cheap CSRF defense for cookie-auth APIs. */
export const originGuard: RequestHandler = (req, _res, next) => {
  const safe = ['GET', 'HEAD', 'OPTIONS'];
  if (safe.includes(req.method)) return next();
  if (req.get('authorization')?.toLowerCase().startsWith('bearer ')) return next();
  // Public endpoints (events ingest, ESP webhooks, preferences-center
  // mutations) authenticate via signed body / token-in-URL — no cookie,
  // no CSRF concern. Skip the origin check for them.
  if (req.path.startsWith('/api/public/') || req.path.startsWith('/p/')) return next();
  const origin = req.get('origin') ?? req.get('referer');
  if (!origin) return next(new HttpError(403, 'Missing origin'));
  try {
    const u = new URL(origin);
    const allowed = new URL(env.APP_ORIGIN);
    if (u.origin === allowed.origin) return next();
  } catch {
    /* fall through */
  }
  next(new HttpError(403, 'Origin not allowed'));
};

const cookieFrom = (req: Request) =>
  (req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE_NAME];

const bearerFrom = (req: Request): string | null => {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  const value = rest.join(' ').trim();
  return value || null;
};

export const attachUser: RequestHandler = async (req, _res, next) => {
  try {
    const cookieToken = cookieFrom(req);
    if (cookieToken) {
      const session = await loadSession(cookieToken);
      if (session) {
        req.user = session.user;
        req.sessionId = session.id;
        return next();
      }
    }
    const bearer = bearerFrom(req);
    if (bearer) {
      const token = await authenticateApiToken(bearer);
      if (token) {
        req.user = token.user;
        req.apiToken = token;
        void touchLastUsed(token);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  next();
};

export const requireUserSession: RequestHandler = (req, _res, next) => {
  if (!req.sessionId || !req.user) {
    return next(new HttpError(401, 'Session authentication required'));
  }
  next();
};

/** Require a Bearer token bearing the given scope. Used by /api/public/track. */
export const requireApiTokenScope =
  (scope: ApiTokenScope): RequestHandler =>
  (req, _res, next) => {
    if (!req.apiToken) return next(new HttpError(401, 'API token required'));
    if (!tokenHasScope(req.apiToken, scope)) {
      return next(new HttpError(403, `Token missing scope: ${scope}`));
    }
    next();
  };
