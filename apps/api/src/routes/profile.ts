import { Router } from 'express';
import { updateProfileSchema } from '@pipelineflow-engagement/shared';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/error.js';

import './_sideEffects.js';

export const profileRouter = Router();

profileRouter.use(requireAuth);

profileRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const input = updateProfileSchema.parse(req.body);
    const user = await prisma.authUser.update({
      where: { id: req.user!.id },
      data: input,
    });
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, theme: user.theme } });
  }),
);
