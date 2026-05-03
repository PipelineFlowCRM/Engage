import { z } from 'zod';

export const broadcastCreateSchema = z.object({
  name: z.string().min(1).max(120),
  templateId: z.number().int().positive(),
  audienceId: z.number().int().positive(),
  scheduledFor: z.string().datetime().optional().nullable(),
  // Per-second send rate cap. Capped at SES quota at send time.
  sendRatePerSecond: z.number().int().min(1).max(1000).default(10),
});
export type BroadcastCreateInput = z.infer<typeof broadcastCreateSchema>;

export const broadcastUpdateSchema = broadcastCreateSchema.partial();
export type BroadcastUpdateInput = z.infer<typeof broadcastUpdateSchema>;

export const broadcastActionSchema = z.object({
  action: z.enum(['launch', 'pause', 'resume', 'cancel']),
});
export type BroadcastActionInput = z.infer<typeof broadcastActionSchema>;

export const broadcastStatuses = [
  'draft', 'scheduled', 'snapshotting', 'running', 'paused',
  'completed', 'cancelled', 'failed',
] as const;
export type BroadcastStatus = typeof broadcastStatuses[number];
