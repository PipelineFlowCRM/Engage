import { z } from 'zod';

// Inbound from PipelineFlow CRM. Signed with HMAC-SHA256 of the raw body
// using CRM_SHARED_SECRET; signature in header `X-Engagement-Signature`.

export const crmContactPayloadSchema = z.object({
  type: z.literal('contact'),
  action: z.enum(['created', 'updated', 'deleted']),
  contact: z.object({
    id: z.union([z.number(), z.string()]),
    email: z.string().email().nullable().optional(),
    phone: z.string().nullable().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    companyName: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    customFields: z.record(z.unknown()).optional(),
  }),
});
export type CrmContactPayload = z.infer<typeof crmContactPayloadSchema>;

// Generic CRM activity event (deal moved, task overdue, etc.) — converted
// into a track() event on the Engagement side keyed to the contact's
// externalId.
export const crmActivityPayloadSchema = z.object({
  type: z.literal('activity'),
  event: z.string().min(1).max(120),       // 'deal.stage_changed', etc.
  contactId: z.union([z.number(), z.string()]),
  properties: z.record(z.unknown()).optional(),
  occurredAt: z.string().datetime(),
});
export type CrmActivityPayload = z.infer<typeof crmActivityPayloadSchema>;

export const crmWebhookPayloadSchema = z.discriminatedUnion('type', [
  crmContactPayloadSchema,
  crmActivityPayloadSchema,
]);
export type CrmWebhookPayload = z.infer<typeof crmWebhookPayloadSchema>;

// Outbound to CRM (Phase 2): delivery lifecycle events that should land on
// the contact's CRM activity timeline.
export const engagementActivityOutboundSchema = z.object({
  contactExternalId: z.string().min(1).max(255),
  event: z.enum([
    'sent', 'delivered', 'opened', 'clicked', 'bounced',
    'complained', 'unsubscribed', 'failed',
  ]),
  templateName: z.string().max(120).optional(),
  subject: z.string().max(998).optional(),
  occurredAt: z.string().datetime(),
});
export type EngagementActivityOutbound = z.infer<typeof engagementActivityOutboundSchema>;
