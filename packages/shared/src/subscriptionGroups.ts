import { z } from 'zod';

export const subscriptionGroupCreateSchema = z.object({
  name: z.string().min(1).max(120),
  channel: z.enum(['email']).default('email'),
  type: z.enum(['opt_in', 'opt_out']).default('opt_out'),
  description: z.string().max(2000).optional().nullable(),
});
export type SubscriptionGroupCreateInput = z.infer<typeof subscriptionGroupCreateSchema>;

export const subscriptionGroupUpdateSchema = subscriptionGroupCreateSchema.partial();
export type SubscriptionGroupUpdateInput = z.infer<typeof subscriptionGroupUpdateSchema>;
