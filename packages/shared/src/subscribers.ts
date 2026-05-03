import { z } from 'zod';

export const subscriberCreateSchema = z.object({
  externalId: z.string().min(1).max(255),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  traits: z.record(z.unknown()).optional(),
  source: z.enum(['api', 'crm', 'import']).optional().default('api'),
});
export type SubscriberCreateInput = z.infer<typeof subscriberCreateSchema>;

export const subscriberUpdateSchema = z.object({
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  traits: z.record(z.unknown()).optional(),
});
export type SubscriberUpdateInput = z.infer<typeof subscriberUpdateSchema>;

export const subscriberListQuerySchema = z.object({
  q: z.string().max(255).optional(),
  source: z.enum(['api', 'crm', 'import']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),       // BigInt id cursor
});
export type SubscriberListQuery = z.infer<typeof subscriberListQuerySchema>;
