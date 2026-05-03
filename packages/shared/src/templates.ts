import { z } from 'zod';

// Template channel is a discriminator: the definition shape depends on it.
// Phase 1 ships email only. SMS/push/webhook are reserved channel values
// to keep the column shape stable when those land in Phase 3.

export const emailTemplateDefinitionSchema = z.object({
  subject: z.string().min(1).max(998),    // RFC 5322 line-length-ish
  fromName: z.string().min(1).max(120),
  fromEmail: z.string().email().max(255),
  replyTo: z.string().email().max(255).optional().nullable(),
  // MJML source. We render to HTML at send time; large blobs (~256KB max)
  // are clamped at the route layer.
  mjml: z.string().min(1).max(262_144),
  // Optional plaintext fallback. If absent, the renderer derives one
  // (html-to-text) at send.
  text: z.string().max(262_144).optional().nullable(),
});
export type EmailTemplateDefinition = z.infer<typeof emailTemplateDefinitionSchema>;

export const templateChannel = z.enum(['email']);    // sms/push/webhook later
export type TemplateChannel = z.infer<typeof templateChannel>;

export const templateCreateSchema = z.object({
  name: z.string().min(1).max(120),
  channel: templateChannel.default('email'),
  // Validated against the channel-specific schema in the route handler.
  definition: emailTemplateDefinitionSchema,
  subscriptionGroupId: z.number().int().positive().nullable().optional(),
});
export type TemplateCreateInput = z.infer<typeof templateCreateSchema>;

export const templateUpdateSchema = templateCreateSchema
  .partial()
  .extend({
    status: z.enum(['draft', 'published', 'archived']).optional(),
  });
export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>;

// Live preview endpoint accepts a partial template + sample subscriber traits.
export const templatePreviewSchema = z.object({
  definition: emailTemplateDefinitionSchema,
  // Sample subscriber. Falls back to a synthetic traits bag if absent.
  subscriberTraits: z.record(z.unknown()).optional(),
});
export type TemplatePreviewInput = z.infer<typeof templatePreviewSchema>;
