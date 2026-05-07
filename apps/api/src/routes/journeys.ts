import { Router } from 'express';
import {
  journeyCreateSchema,
  journeyUpdateSchema,
  journeyPublishSchema,
  journeyActionSchema,
  journeyDefinitionSchema,
} from '@pipelineflow-engagement/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../lib/error.js';
import { param } from '../lib/params.js';
import { audit } from '../lib/audit.js';
import { LOCK_NS, withBlockingAdvisoryLock } from '../lib/locks.js';

import './_sideEffects.js';

export const journeysRouter = Router();
journeysRouter.use(requireAuth);

journeysRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.journey.findMany({
      include: { currentVersion: true },
      orderBy: { id: 'desc' },
    });
    // Aggregate run counts per journey in one query.
    const counts = await prisma.journeyRun.groupBy({
      by: ['journeyId', 'status'],
      _count: { _all: true },
    });
    const byJourney = new Map<number, Record<string, number>>();
    for (const c of counts) {
      const cur = byJourney.get(c.journeyId) ?? {};
      cur[c.status] = c._count._all;
      byJourney.set(c.journeyId, cur);
    }
    res.json({
      journeys: rows.map((r) => ({
        ...r,
        runCounts: byJourney.get(r.id) ?? {},
      })),
    });
  }),
);

journeysRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(param(req, 'id'));
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const row = await prisma.journey.findUnique({
      where: { id },
      include: {
        currentVersion: true,
        // Last few versions surfaced so the operator can see version drift.
        versions: { orderBy: { version: 'desc' }, take: 10 },
      },
    });
    if (!row) throw new HttpError(404, 'Journey not found');
    res.json({ journey: row });
  }),
);

// Create a journey in `draft` status. If a definition is provided it's
// validated and stored as version 1, but currentVersionId stays null until
// `publish` is called — drafts shouldn't trigger runs.
journeysRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = journeyCreateSchema.parse(req.body);
    const row = await prisma.$transaction(async (tx) => {
      const j = await tx.journey.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          status: 'draft',
        },
      });
      if (input.definition) {
        await tx.journeyVersion.create({
          data: {
            journeyId: j.id,
            version: 1,
            definition: input.definition as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return tx.journey.findUnique({
        where: { id: j.id },
        include: { currentVersion: true },
      });
    });
    await audit(req, 'journey.create', `journey:${row!.id}`, { name: row!.name });
    res.status(201).json({ journey: row });
  }),
);

// Save a draft. Doesn't bump currentVersionId; just rewrites the latest
// JourneyVersion in place if it's never been published, or appends a new
// draft version row. The simpler thing in Phase 2 is: always save the
// definition into a single "working draft" row keyed by (journeyId, version=
// max-published+1). Then publish promotes that row.
journeysRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(param(req, 'id'));
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const input = journeyUpdateSchema.parse(req.body);

    // Lock per-journey so concurrent save-draft + publish (or two saves
    // racing through React-Query retries) serialize. Without this, both
    // could try to insert the same (journeyId, version) and one would
    // fail with a P2002 unique-constraint error.
    const row = await withBlockingAdvisoryLock(LOCK_NS.journey, id, async (tx) => {
      const j = await tx.journey.findUnique({ where: { id } });
      if (!j) throw new HttpError(404, 'Journey not found');

      await tx.journey.update({
        where: { id },
        data: {
          name: input.name ?? undefined,
          description: input.description ?? undefined,
        },
      });

      if (input.definition) {
        // Find draft version (= current+1, or 1 if never published).
        const latest = await tx.journeyVersion.aggregate({
          where: { journeyId: id },
          _max: { version: true },
        });
        const currentVersion = j.currentVersionId
          ? (await tx.journeyVersion.findUnique({ where: { id: j.currentVersionId } }))?.version ?? 0
          : 0;
        const draftVersionNumber = Math.max(currentVersion + 1, latest._max.version ?? 0);

        const existingDraft = await tx.journeyVersion.findUnique({
          where: { journeyId_version: { journeyId: id, version: draftVersionNumber } },
        });
        if (existingDraft && existingDraft.id !== j.currentVersionId) {
          await tx.journeyVersion.update({
            where: { id: existingDraft.id },
            data: { definition: input.definition as unknown as Prisma.InputJsonValue },
          });
        } else {
          await tx.journeyVersion.create({
            data: {
              journeyId: id,
              version: (currentVersion ?? 0) + 1,
              definition: input.definition as unknown as Prisma.InputJsonValue,
            },
          });
        }
      }

      return tx.journey.findUnique({
        where: { id },
        include: { currentVersion: true, versions: { orderBy: { version: 'desc' }, take: 5 } },
      });
    });
    await audit(req, 'journey.update', `journey:${id}`);
    res.json({ journey: row });
  }),
);

journeysRouter.post(
  '/:id/publish',
  asyncHandler(async (req, res) => {
    const id = Number(param(req, 'id'));
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const input = journeyPublishSchema.parse(req.body);

    // Validate the definition fully (deep — Zod superRefine catches dangling
    // node references).
    journeyDefinitionSchema.parse(input.definition);

    // See PATCH route — same lock keeps publish from racing a concurrent
    // save-draft on the same journey id.
    const row = await withBlockingAdvisoryLock(LOCK_NS.journey, id, async (tx) => {
      const j = await tx.journey.findUnique({
        where: { id },
        include: { currentVersion: true },
      });
      if (!j) throw new HttpError(404, 'Journey not found');

      // The PATCH (save-draft) route maintains the invariant: at most one
      // "working draft" version row per journey, sitting at version
      // (currentVersion.version + 1) — or version 1 when nothing has ever
      // been published. Publish promotes that draft in place instead of
      // appending a sibling, so the version sequence has no orphan rows.
      const publishedVersion = j.currentVersion?.version ?? 0;
      const draft = await tx.journeyVersion.findFirst({
        where: { journeyId: id, version: { gt: publishedVersion } },
        orderBy: { version: 'desc' },
      });

      const v = draft
        ? await tx.journeyVersion.update({
            where: { id: draft.id },
            data: { definition: input.definition as unknown as Prisma.InputJsonValue },
          })
        : await tx.journeyVersion.create({
            data: {
              journeyId: id,
              version: publishedVersion + 1,
              definition: input.definition as unknown as Prisma.InputJsonValue,
            },
          });

      return tx.journey.update({
        where: { id },
        data: {
          currentVersionId: v.id,
          status: 'published',
        },
        include: { currentVersion: true },
      });
    });
    await audit(req, 'journey.publish', `journey:${id}`, { version: row.currentVersion?.version });
    res.json({ journey: row });
  }),
);

// Pause = stop accepting new triggers; in-flight runs continue. Resume
// flips back. Archive = no triggers, no runs continue (existing waits hit
// their timeouts naturally; the runner sees status='archived' and exits the
// run with reason 'journey-archived').
journeysRouter.post(
  '/:id/actions',
  asyncHandler(async (req, res) => {
    const id = Number(param(req, 'id'));
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const { action } = journeyActionSchema.parse(req.body);
    const j = await prisma.journey.findUnique({ where: { id } });
    if (!j) throw new HttpError(404, 'Journey not found');

    let nextStatus = j.status;
    if (action === 'pause') {
      if (j.status !== 'published') throw new HttpError(409, `Cannot pause from '${j.status}'`);
      nextStatus = 'paused';
    } else if (action === 'resume') {
      if (j.status !== 'paused') throw new HttpError(409, `Cannot resume from '${j.status}'`);
      nextStatus = 'published';
    } else if (action === 'archive') {
      nextStatus = 'archived';
    }

    const row = await prisma.journey.update({
      where: { id },
      data: { status: nextStatus },
      include: { currentVersion: true },
    });
    await audit(req, `journey.${action}`, `journey:${id}`);
    res.json({ journey: row });
  }),
);

journeysRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(param(req, 'id'));
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const runCount = await prisma.journeyRun.count({ where: { journeyId: id } });
    if (runCount > 0) {
      throw new HttpError(409, `Cannot delete: ${runCount} runs exist. Archive instead.`);
    }
    await prisma.journey.delete({ where: { id } });
    await audit(req, 'journey.delete', `journey:${id}`);
    res.status(204).end();
  }),
);

// Run inspection — paginated by id desc.
journeysRouter.get(
  '/:id/runs',
  asyncHandler(async (req, res) => {
    const id = Number(param(req, 'id'));
    if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
    const limit = Math.min(Number(req.query['limit'] ?? 50), 200);
    const cursor = req.query['cursor'] ? BigInt(String(req.query['cursor'])) : undefined;
    const status = typeof req.query['status'] === 'string' ? String(req.query['status']) : undefined;

    const rows = await prisma.journeyRun.findMany({
      where: { journeyId: id, ...(status ? { status } : {}) },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'desc' },
      take: limit,
      include: {
        subscriber: { select: { externalId: true, email: true } },
        version: { select: { version: true } },
      },
    });
    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id.toString() : null;
    res.json({ runs: rows, nextCursor });
  }),
);

journeysRouter.get(
  '/:id/runs/:runId',
  asyncHandler(async (req, res) => {
    const id = Number(param(req, 'id'));
    const runId = BigInt(param(req, 'runId'));
    const run = await prisma.journeyRun.findFirst({
      where: { id: runId, journeyId: id },
      include: {
        subscriber: { select: { externalId: true, email: true } },
        version: true,
        steps: { orderBy: { occurredAt: 'asc' } },
        wait: true,
      },
    });
    if (!run) throw new HttpError(404, 'Run not found');
    res.json({ run });
  }),
);
