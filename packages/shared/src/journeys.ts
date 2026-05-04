import { z } from 'zod';

// Journey definition is a JSON DAG: { entry: nodeId, nodes: { [id]: Node } }.
// Each non-terminal node points to the next node by id; SegmentSplit branches
// on audience membership; WaitFor has a primary `next` (signal arrived) and
// `timeoutNext` (deadline reached). The runner walks one node per tick (with
// a per-tick bound to prevent hot loops).

const nodeId = z.string().min(1).max(64);

// ─── Node bodies ───────────────────────────────────────────────────────────

// Entry nodes don't have a `next` — the journey graph's `entry` is the
// EventEntry/SegmentEntry node id, and the *first non-entry node* points to
// the actual flow start. Entry nodes are matched by triggers (audience
// compute / events ingest) when activating a new run for a subscriber.
const eventEntryNode = z.object({
  type: z.literal('EventEntry'),
  // Start a new run when this event name lands for a subscriber not already
  // in a running journey at the same versionId.
  event: z.string().min(1).max(255),
  // Optional property predicate. Matches the audience Performed-node shape.
  properties: z
    .array(
      z.object({
        key: z.string().min(1).max(255),
        operator: z.enum(['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'exists', 'notExists', 'contains', 'notContains']),
        value: z.union([z.string(), z.number(), z.boolean()]).optional(),
      }),
    )
    .max(20)
    .optional(),
  // Where flow proceeds after the entry is matched.
  next: nodeId,
});

const segmentEntryNode = z.object({
  type: z.literal('SegmentEntry'),
  // Start a new run when a subscriber enters this audience.
  audienceId: z.number().int().positive(),
  next: nodeId,
});

// Delay sub-types. Phase 2 ships `seconds` + `localized-time`. The
// `userProperty` variant (delay until a date stored in a trait) is deferred.
const delaySeconds = z.object({
  kind: z.literal('seconds'),
  seconds: z.number().int().min(1).max(60 * 60 * 24 * 365), // 1s — 1y
});
const delayLocalizedTime = z.object({
  kind: z.literal('localized-time'),
  // 24h clock, subscriber-local. Falls back to UTC if subscriber.traits.timezone
  // is unset or not a valid IANA tz.
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  // Day-of-week filter. Empty array = any day.
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

const delayNode = z.object({
  type: z.literal('Delay'),
  delay: z.discriminatedUnion('kind', [delaySeconds, delayLocalizedTime]),
  next: nodeId,
});

const messageNode = z.object({
  type: z.literal('Message'),
  templateId: z.number().int().positive(),
  next: nodeId,
});

const waitForNode = z.object({
  type: z.literal('WaitFor'),
  signal: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('event'),
      event: z.string().min(1).max(255),
      // Optional predicate against event.properties.
      properties: z
        .array(
          z.object({
            key: z.string().min(1).max(255),
            operator: z.enum(['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'exists', 'notExists', 'contains', 'notContains']),
            value: z.union([z.string(), z.number(), z.boolean()]).optional(),
          }),
        )
        .max(20)
        .optional(),
    }),
    z.object({ kind: z.literal('audience-enter'), audienceId: z.number().int().positive() }),
    z.object({ kind: z.literal('audience-exit'), audienceId: z.number().int().positive() }),
  ]),
  // Hard ceiling. The wait-sweep job fires the timeout branch when this
  // expires.
  timeoutSeconds: z.number().int().min(60).max(60 * 60 * 24 * 365),
  // Where flow proceeds when the signal arrives.
  next: nodeId,
  // Where flow proceeds when timeout fires. Optional — absent means Exit.
  timeoutNext: nodeId.optional(),
});

const segmentSplitNode = z.object({
  type: z.literal('SegmentSplit'),
  audienceId: z.number().int().positive(),
  trueNext: nodeId,
  falseNext: nodeId,
});

const exitNode = z.object({
  type: z.literal('Exit'),
  // Optional reason surfaced in JourneyRunStep.meta.
  reason: z.string().max(255).optional(),
});

export const journeyNodeSchema = z.discriminatedUnion('type', [
  eventEntryNode,
  segmentEntryNode,
  delayNode,
  messageNode,
  waitForNode,
  segmentSplitNode,
  exitNode,
]);
export type JourneyNode = z.infer<typeof journeyNodeSchema>;

export const journeyDefinitionSchema = z
  .object({
    entry: nodeId,
    nodes: z.record(nodeId, journeyNodeSchema),
  })
  .superRefine((def, ctx) => {
    // Entry must exist and be an *Entry node.
    const entry = def.nodes[def.entry];
    if (!entry) {
      ctx.addIssue({
        code: 'custom',
        path: ['entry'],
        message: `entry node '${def.entry}' not found in nodes`,
      });
      return;
    }
    if (entry.type !== 'EventEntry' && entry.type !== 'SegmentEntry') {
      ctx.addIssue({
        code: 'custom',
        path: ['entry'],
        message: `entry node must be EventEntry or SegmentEntry, got ${entry.type}`,
      });
    }
    // Every referenced `next` / `trueNext` / `falseNext` / `timeoutNext` must exist.
    for (const [id, node] of Object.entries(def.nodes)) {
      const refs: Array<[string, string]> = [];
      if ('next' in node && node.next) refs.push(['next', node.next]);
      if (node.type === 'SegmentSplit') {
        refs.push(['trueNext', node.trueNext]);
        refs.push(['falseNext', node.falseNext]);
      }
      if (node.type === 'WaitFor' && node.timeoutNext) {
        refs.push(['timeoutNext', node.timeoutNext]);
      }
      for (const [field, refId] of refs) {
        if (!def.nodes[refId]) {
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', id, field],
            message: `points to missing node '${refId}'`,
          });
        }
      }
    }
  });
export type JourneyDefinition = z.infer<typeof journeyDefinitionSchema>;

// ─── CRUD schemas ─────────────────────────────────────────────────────────

export const journeyCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  // Drafts can be saved with an in-progress definition; publish validates.
  definition: journeyDefinitionSchema.optional(),
});
export type JourneyCreateInput = z.infer<typeof journeyCreateSchema>;

export const journeyUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  definition: journeyDefinitionSchema.optional(),
});
export type JourneyUpdateInput = z.infer<typeof journeyUpdateSchema>;

// Publish promotes a journey to a new JourneyVersion and bumps
// currentVersionId. Body carries the definition so a client can save+publish
// in one call; the route also accepts an empty body and re-uses the last
// saved draft definition.
export const journeyPublishSchema = z.object({
  definition: journeyDefinitionSchema,
});
export type JourneyPublishInput = z.infer<typeof journeyPublishSchema>;

export const journeyActionSchema = z.object({
  action: z.enum(['pause', 'resume', 'archive']),
});
export type JourneyActionInput = z.infer<typeof journeyActionSchema>;
