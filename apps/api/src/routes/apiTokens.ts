import { Router } from 'express';
import { apiTokenCreateSchema } from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { requireUserSession } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../lib/error.js';
import { param } from '../lib/params.js';
import {
  formatToken,
  hashTokenSecret,
  newTokenId,
  newTokenSecret,
} from '../auth/apiToken.js';
import { audit } from '../lib/audit.js';

import './_sideEffects.js';

export const apiTokensRouter = Router();
apiTokensRouter.use(requireUserSession);

apiTokensRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.apiToken.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    res.json({ tokens: rows });
  }),
);

apiTokensRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = apiTokenCreateSchema.parse(req.body);
    const id = newTokenId();
    const secret = newTokenSecret();
    const secretHash = await hashTokenSecret(secret);
    const row = await prisma.apiToken.create({
      data: {
        id,
        userId: req.user!.id,
        name: input.name,
        secretHash,
        scopes: input.scopes,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    await audit(req, 'api_token.create', `token:${id}`, { name: input.name });
    // The full token is returned ONCE. We never store it; we never return it again.
    res.status(201).json({
      token: {
        id: row.id,
        name: row.name,
        scopes: row.scopes,
        expiresAt: row.expiresAt,
      },
      // Wire format the operator must record now.
      secret: formatToken(id, secret),
    });
  }),
);

apiTokensRouter.post(
  '/:id/revoke',
  asyncHandler(async (req, res) => {
    const id = param(req, 'id');
    const row = await prisma.apiToken.findFirst({ where: { id, userId: req.user!.id } });
    if (!row) throw new HttpError(404, 'Token not found');
    await prisma.apiToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await audit(req, 'api_token.revoke', `token:${id}`);
    res.status(204).end();
  }),
);
