import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  aliasEventSchema,
  batchEventSchema,
  groupEventSchema,
  identifyEventSchema,
  pageEventSchema,
  screenEventSchema,
  trackEventSchema,
  type EventIngestJobData,
} from '@pipelineflow-engagement/shared';
import { requireApiTokenScope } from '../../auth/middleware.js';
import { asyncHandler, HttpError } from '../../lib/error.js';
import { enqueueEventIngest } from '../../lib/queue.js';

import '../_sideEffects.js';

export const trackRouter = Router();

// All events ingest endpoints require a Bearer ApiToken with engagement:ingest.
trackRouter.use(requireApiTokenScope('engagement:ingest'));

type AnyEvent = {
  type: 'track' | 'identify' | 'page' | 'screen' | 'group' | 'alias';
  event?: string;
  name?: string;
  // Identity (track/identify/page/screen/group). At least one required.
  userId?: string;
  anonymousId?: string;
  // Alias fields (replaces userId+anonymousId for type=alias).
  previousId?: string;
  groupId?: string;
  traits?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  context?: Record<string, unknown>;
  messageId?: string;
  timestamp?: string;
  receivedAt?: string;
};

function toJobData(ev: AnyEvent, defaultReceivedAt: string): EventIngestJobData {
  // Resolve identity. alias is special: previousId + userId.
  let externalId: string | null = null;
  let anonymousId: string | null = null;
  let previousId: string | null = null;
  if (ev.type === 'alias') {
    externalId = ev.userId ?? null;
    previousId = ev.previousId ?? null;
    if (!externalId || !previousId) {
      throw new HttpError(400, 'alias requires userId and previousId');
    }
  } else {
    externalId = ev.userId ?? null;
    anonymousId = ev.anonymousId ?? null;
    if (!externalId && !anonymousId) {
      throw new HttpError(400, `${ev.type} requires userId or anonymousId`);
    }
  }
  // group events embed an extra group id. We surface it as a property so the
  // segment compiler sees it without needing a separate column.
  const properties =
    ev.type === 'group'
      ? { ...(ev.properties ?? {}), groupId: ev.groupId }
      : ev.properties;

  return {
    type: ev.type,
    messageId: ev.messageId ?? randomUUID(),
    externalId: externalId ?? null,
    anonymousId: anonymousId ?? null,
    previousId,
    traits: ev.traits ?? null,
    name: ev.event ?? ev.name ?? null,
    properties: properties ?? null,
    context: ev.context ?? null,
    observedAt: ev.timestamp ?? defaultReceivedAt,
    receivedAt: ev.receivedAt ?? defaultReceivedAt,
    source: 'api',
  };
}

trackRouter.post(
  '/track',
  asyncHandler(async (req, res) => {
    const input = trackEventSchema.parse({ type: 'track', ...(req.body ?? {}) });
    const job = toJobData({ ...input, type: 'track' as const }, new Date().toISOString());
    await enqueueEventIngest(job);
    res.status(202).json({ messageId: job.messageId });
  }),
);

trackRouter.post(
  '/identify',
  asyncHandler(async (req, res) => {
    const input = identifyEventSchema.parse({ type: 'identify', ...(req.body ?? {}) });
    const job = toJobData({ ...input, type: 'identify' as const }, new Date().toISOString());
    await enqueueEventIngest(job);
    res.status(202).json({ messageId: job.messageId });
  }),
);

trackRouter.post(
  '/page',
  asyncHandler(async (req, res) => {
    const input = pageEventSchema.parse({ type: 'page', ...(req.body ?? {}) });
    const job = toJobData({ ...input, type: 'page' as const }, new Date().toISOString());
    await enqueueEventIngest(job);
    res.status(202).json({ messageId: job.messageId });
  }),
);

trackRouter.post(
  '/screen',
  asyncHandler(async (req, res) => {
    const input = screenEventSchema.parse({ type: 'screen', ...(req.body ?? {}) });
    const job = toJobData({ ...input, type: 'screen' as const }, new Date().toISOString());
    await enqueueEventIngest(job);
    res.status(202).json({ messageId: job.messageId });
  }),
);

trackRouter.post(
  '/group',
  asyncHandler(async (req, res) => {
    const input = groupEventSchema.parse({ type: 'group', ...(req.body ?? {}) });
    const job = toJobData({ ...input, type: 'group' as const }, new Date().toISOString());
    await enqueueEventIngest(job);
    res.status(202).json({ messageId: job.messageId });
  }),
);

trackRouter.post(
  '/alias',
  asyncHandler(async (req, res) => {
    const input = aliasEventSchema.parse({ type: 'alias', ...(req.body ?? {}) });
    const job = toJobData({ ...input, type: 'alias' as const }, new Date().toISOString());
    await enqueueEventIngest(job);
    res.status(202).json({ messageId: job.messageId });
  }),
);

trackRouter.post(
  '/batch',
  asyncHandler(async (req, res) => {
    const input = batchEventSchema.parse(req.body);
    const now = new Date().toISOString();
    const messageIds: string[] = [];
    for (const ev of input.batch) {
      const job = toJobData(ev as AnyEvent, now);
      await enqueueEventIngest(job);
      messageIds.push(job.messageId);
    }
    res.status(202).json({ messageIds });
  }),
);
