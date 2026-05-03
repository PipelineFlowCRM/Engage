import { Router } from 'express';
import {
  templateCreateSchema,
  templatePreviewSchema,
  templateUpdateSchema,
  emailTemplateDefinitionSchema,
} from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../lib/error.js';
import { renderEmail } from '../lib/render.js';
import { audit } from '../lib/audit.js';

import './_sideEffects.js';

export const templatesRouter = Router();

templatesRouter.use(requireAuth);

templatesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.template.findMany({
      include: { subscriptionGroup: true },
      orderBy: { id: 'desc' },
    });
    res.json({ templates: rows });
  }),
);

templatesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const t = await prisma.template.findUnique({
      where: { id },
      include: { subscriptionGroup: true },
    });
    if (!t) throw new HttpError(404, 'Template not found');
    res.json({ template: t });
  }),
);

templatesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = templateCreateSchema.parse(req.body);
    // Validate channel-specific definition shape.
    emailTemplateDefinitionSchema.parse(input.definition);
    const created = await prisma.template.create({
      data: {
        name: input.name,
        channel: input.channel,
        definition: input.definition,
        subscriptionGroupId: input.subscriptionGroupId ?? null,
      },
    });
    await audit(req, 'template.create', `template:${created.id}`, { name: created.name });
    res.status(201).json({ template: created });
  }),
);

templatesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const input = templateUpdateSchema.parse(req.body);
    if (input.definition) emailTemplateDefinitionSchema.parse(input.definition);
    const updated = await prisma.template.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        channel: input.channel ?? undefined,
        definition: input.definition ?? undefined,
        subscriptionGroupId: input.subscriptionGroupId ?? undefined,
        status: input.status ?? undefined,
      },
    });
    if (input.status === 'published') {
      await audit(req, 'template.publish', `template:${id}`);
    } else {
      await audit(req, 'template.update', `template:${id}`);
    }
    res.json({ template: updated });
  }),
);

templatesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    await prisma.template.delete({ where: { id } });
    await audit(req, 'template.delete', `template:${id}`);
    res.status(204).end();
  }),
);

// Live preview endpoint for the editor. Renders MJML+Liquid in-process.
// Liquid context = sample subscriber traits + a synthetic
// `unsubscribe_url`. Refuses to render if the operator hasn't supplied a
// reasonable `from`/`subject`.
templatesRouter.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const input = templatePreviewSchema.parse(req.body);
    const out = await renderEmail({
      ...input.definition,
      context: {
        subscriber: {
          email: 'preview@example.com',
          firstName: 'Preview',
          ...input.subscriberTraits,
        },
        unsubscribe_url: `${process.env.APP_ORIGIN ?? ''}/p/preferences/PREVIEW_TOKEN`,
      },
    });
    res.json({ preview: out });
  }),
);
