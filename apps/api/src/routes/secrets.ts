import { Router } from 'express';
import { amazonSesConfigSchema, secretSetSchema } from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { requireUserSession } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../lib/error.js';
import { encryptJson } from '../lib/crypto.js';
import { param } from '../lib/params.js';
import { audit } from '../lib/audit.js';

import './_sideEffects.js';

export const secretsRouter = Router();
// Setting secrets is admin-territory: API tokens explicitly cannot escalate.
secretsRouter.use(requireUserSession);

// List of secret names + presence flags. Never returns the encrypted blob.
secretsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.secret.findMany({
      select: { id: true, name: true, createdAt: true, updatedAt: true },
      orderBy: { name: 'asc' },
    });
    res.json({ secrets: rows });
  }),
);

// Set/replace. The route validates the value shape against the named schema.
secretsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = secretSetSchema.parse(req.body);
    const validated = validateSecretByName(input.name, input.value);
    const encrypted = encryptJson(validated);
    const row = await prisma.secret.upsert({
      where: { name: input.name },
      create: { name: input.name, encrypted },
      update: { encrypted },
    });
    await audit(req, 'secret.set', `secret:${input.name}`);
    res.status(201).json({ secret: { id: row.id, name: row.name, updatedAt: row.updatedAt } });
  }),
);

secretsRouter.delete(
  '/:name',
  asyncHandler(async (req, res) => {
    const name = param(req, 'name');
    await prisma.secret.delete({ where: { name } }).catch(() => undefined);
    await audit(req, 'secret.delete', `secret:${name}`);
    res.status(204).end();
  }),
);

function validateSecretByName(name: string, value: unknown): unknown {
  switch (name) {
    case 'amazon-ses':
      return amazonSesConfigSchema.parse(value);
    default:
      throw new HttpError(400, `Unknown secret name: ${name}`);
  }
}
