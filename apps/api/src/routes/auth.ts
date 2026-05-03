import { Router } from 'express';
import {
  loginSchema,
  registerSchema,
  changePasswordSchema,
  ssoTokenPayloadSchema,
} from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createSession, destroySession } from '../auth/sessions.js';
import { requireAuth, requireUserSession } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../lib/error.js';
import { verifySsoToken } from '../lib/crmAuth.js';
import { env } from '../env.js';
import { audit } from '../lib/audit.js';

import './_sideEffects.js';

export const authRouter = Router();

// Self-service registration. Locked when an admin already exists — for OSS
// self-host this is the bootstrap flow only.
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const existing = await prisma.authUser.count();
    if (existing > 0) {
      throw new HttpError(403, 'Self-service registration is disabled. Ask an admin to invite you.');
    }
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.authUser.create({
      data: { email: input.email, name: input.name, passwordHash, role: 'admin' },
    });
    await createSession(req, res, user.id);
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, theme: user.theme } });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await prisma.authUser.findUnique({ where: { email: input.email } });
    if (!user) {
      // Constant-time-ish: still hash a dummy so timing doesn't leak existence.
      await verifyPassword(
        '$argon2id$v=19$m=65536,t=3,p=4$YQ$YQ', // intentionally invalid
        input.password,
      ).catch(() => false);
      throw new HttpError(401, 'Invalid email or password');
    }
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) throw new HttpError(401, 'Invalid email or password');
    await createSession(req, res, user.id);
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, theme: user.theme } });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await destroySession(req, res);
    res.status(204).end();
  }),
);

authRouter.get('/me', requireAuth, (req, res) => {
  const u = req.user!;
  res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role, theme: u.theme } });
});

authRouter.post(
  '/change-password',
  requireUserSession,
  asyncHandler(async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    const user = req.user!;
    const ok = await verifyPassword(user.passwordHash, input.currentPassword);
    if (!ok) throw new HttpError(403, 'Current password is incorrect');
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.authUser.update({ where: { id: user.id }, data: { passwordHash } });
    await audit(req, 'auth.password_changed', `user:${user.id}`);
    res.status(204).end();
  }),
);

// SSO endpoint for the CRM bridge. The CRM mints a JWT; we verify, upsert
// an AuthUser by email (creating with a random password the user can never
// log in with directly), and mint our own session cookie. Idempotent —
// repeated SSO from the same email keeps the same AuthUser row.
authRouter.get(
  '/sso',
  asyncHandler(async (req, res) => {
    if (!env.CRM_SHARED_SECRET) {
      throw new HttpError(503, 'SSO disabled (CRM bridge not configured)');
    }
    const token = String(req.query['token'] ?? '');
    if (!token) throw new HttpError(400, 'Missing token');
    const payload = await verifySsoToken(token);
    const parsed = ssoTokenPayloadSchema.parse(payload);

    let user = await prisma.authUser.findUnique({ where: { email: parsed.sub } });
    if (!user) {
      // Random password — SSO-managed accounts can change it later via
      // change-password if they set one through the UI.
      const passwordHash = await hashPassword(
        Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
      );
      user = await prisma.authUser.create({
        data: { email: parsed.sub, name: parsed.name, passwordHash, role: 'admin' },
      });
      await audit(req, 'auth.sso_provisioned', `user:${user.id}`, { email: parsed.sub });
    }
    await createSession(req, res, user.id);
    // Redirect into the SPA after cookie is set. Defaults to dashboard.
    const next = String(req.query['next'] ?? '/');
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    res.redirect(`${env.APP_ORIGIN}${safeNext}`);
  }),
);
