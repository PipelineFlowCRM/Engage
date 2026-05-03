import { z } from 'zod';

// Segment.com-shaped events — kept verbatim so any Segment-compatible SDK
// can target this API without modification. Field names match the Segment
// HTTP spec (camelCase variants accepted via aliases at the route layer).

const isoDate = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'invalid ISO date' });

const stringId = z.string().min(1).max(255);

// `properties` and `traits` are arbitrary JSON-shaped bags. We refuse
// nested objects deeper than 6 levels and arrays larger than 200 elements
// at the route layer (defense against pathological payloads). The Zod
// schema itself just confirms it's a record.
const flexibleBag = z.record(z.unknown());

const baseFields = z.object({
  messageId: stringId.optional(),
  timestamp: isoDate.optional(),       // caller's clock (Segment convention)
  sentAt: isoDate.optional(),
  receivedAt: isoDate.optional(),
  context: flexibleBag.optional(),
  // Identity. At least one of (userId, anonymousId) must be present — the
  // route layer enforces this.
  userId: stringId.optional(),
  anonymousId: stringId.optional(),
});

export const trackEventSchema = baseFields.extend({
  type: z.literal('track').optional().default('track'),
  event: z.string().min(1).max(255),
  properties: flexibleBag.optional(),
});
export type TrackEventInput = z.infer<typeof trackEventSchema>;

export const identifyEventSchema = baseFields.extend({
  type: z.literal('identify').optional().default('identify'),
  traits: flexibleBag.optional(),
});
export type IdentifyEventInput = z.infer<typeof identifyEventSchema>;

export const pageEventSchema = baseFields.extend({
  type: z.literal('page').optional().default('page'),
  name: z.string().max(255).optional(),
  category: z.string().max(255).optional(),
  properties: flexibleBag.optional(),
});
export type PageEventInput = z.infer<typeof pageEventSchema>;

export const screenEventSchema = baseFields.extend({
  type: z.literal('screen').optional().default('screen'),
  name: z.string().max(255).optional(),
  category: z.string().max(255).optional(),
  properties: flexibleBag.optional(),
});
export type ScreenEventInput = z.infer<typeof screenEventSchema>;

export const groupEventSchema = baseFields.extend({
  type: z.literal('group').optional().default('group'),
  groupId: stringId,
  traits: flexibleBag.optional(),
});
export type GroupEventInput = z.infer<typeof groupEventSchema>;

// Alias merges previousId into userId. Both are required.
export const aliasEventSchema = z.object({
  type: z.literal('alias').optional().default('alias'),
  messageId: stringId.optional(),
  timestamp: isoDate.optional(),
  context: flexibleBag.optional(),
  userId: stringId,
  previousId: stringId,
});
export type AliasEventInput = z.infer<typeof aliasEventSchema>;

export const batchEventSchema = z.object({
  batch: z
    .array(
      z.discriminatedUnion('type', [
        trackEventSchema.extend({ type: z.literal('track') }),
        identifyEventSchema.extend({ type: z.literal('identify') }),
        pageEventSchema.extend({ type: z.literal('page') }),
        screenEventSchema.extend({ type: z.literal('screen') }),
        groupEventSchema.extend({ type: z.literal('group') }),
        aliasEventSchema.extend({ type: z.literal('alias') }),
      ]),
    )
    .min(1)
    .max(500),
  context: flexibleBag.optional(),
});
export type BatchEventInput = z.infer<typeof batchEventSchema>;
