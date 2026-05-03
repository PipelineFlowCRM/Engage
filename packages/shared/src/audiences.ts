import { z } from 'zod';

// Audience definition is a JSON tree. Phase 1 supports And/Or/Trait/Performed.
// Manual, RandomBucket, Email-engagement, SubscriptionGroup nodes are
// deferred to Phase 3 — defining the shape now means UI + compiler don't
// need a versioning layer the moment we add them. A new node type
// requires a code change (compiler case + Zod variant); the column is
// free-form Json.

const traitOperator = z.enum([
  'equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'exists', 'notExists',
  'contains', 'notContains',
]);
export type TraitOperator = z.infer<typeof traitOperator>;

const traitNode = z.object({
  type: z.literal('Trait'),
  key: z.string().min(1).max(255),
  operator: traitOperator,
  // Required unless operator is exists/notExists. The compiler enforces.
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const performedWindow = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lastDays'), days: z.number().int().min(1).max(3650) }),
  z.object({ kind: z.literal('ever') }),
  z.object({
    kind: z.literal('between'),
    from: z.string(),
    to: z.string(),
  }),
]);

const performedTimes = z.object({
  op: z.enum(['gte', 'lte', 'eq']),
  count: z.number().int().min(0).max(1_000_000),
});

const performedPropertyFilter = z.object({
  key: z.string().min(1).max(255),
  operator: traitOperator,
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const performedNode = z.object({
  type: z.literal('Performed'),
  event: z.string().min(1).max(255),
  window: performedWindow,
  times: performedTimes,
  properties: z.array(performedPropertyFilter).max(20).optional(),
});

// And/Or are recursive. Use lazy + ZodType alias.
export type AudienceNode =
  | z.infer<typeof traitNode>
  | z.infer<typeof performedNode>
  | { type: 'And'; children: AudienceNode[] }
  | { type: 'Or'; children: AudienceNode[] };

export const audienceNodeSchema: z.ZodType<AudienceNode> = z.lazy(() =>
  z.union([
    traitNode,
    performedNode,
    z.object({
      type: z.literal('And'),
      children: z.array(audienceNodeSchema).min(1).max(20),
    }),
    z.object({
      type: z.literal('Or'),
      children: z.array(audienceNodeSchema).min(1).max(20),
    }),
  ]),
);

export const audienceDefinitionSchema = z.object({
  root: audienceNodeSchema,
});
export type AudienceDefinition = z.infer<typeof audienceDefinitionSchema>;

export const audienceCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  definition: audienceDefinitionSchema,
  computeIntervalSeconds: z.number().int().min(30).max(86_400).optional().default(300),
});
export type AudienceCreateInput = z.infer<typeof audienceCreateSchema>;

export const audienceUpdateSchema = audienceCreateSchema
  .partial()
  .extend({
    status: z.enum(['active', 'paused', 'archived']).optional(),
  });
export type AudienceUpdateInput = z.infer<typeof audienceUpdateSchema>;
