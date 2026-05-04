// All BullMQ queue names + job data shapes are declared here so api and
// worker can't drift. Keep names prefixed with `engagement-` so a shared
// Redis with PipelineFlow CRM doesn't collide.

// ─── Event ingest ───────────────────────────────────────────────────────────
export const QUEUE_EVENT_INGEST = 'engagement-event-ingest' as const;

// The raw payload as received from /api/public/{track,identify,...}, plus
// resolution hints. The worker upserts the Subscriber, merges traits, and
// writes the Event row in a single transaction. Per-subscriber serialization
// via BullMQ groupId = externalId || anonymousId.
export type EventIngestJobData = {
  type: 'track' | 'identify' | 'page' | 'screen' | 'group' | 'alias';
  messageId: string;
  externalId?: string | null;
  anonymousId?: string | null;
  // For alias: the prior id being merged into externalId.
  previousId?: string | null;
  // For identify: trait merge bag.
  traits?: Record<string, unknown> | null;
  name?: string | null;       // event name for type=track
  properties?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
  observedAt: string;          // ISO string from caller
  receivedAt: string;          // ISO string set by API
  source: 'api' | 'crm' | 'import';
};
export type EventIngestJobResult = {
  outcome: 'inserted' | 'duplicate' | 'rejected';
  subscriberId?: string;       // BigInt rendered as string for JSON
};

// ─── Audience compute ───────────────────────────────────────────────────────
export const QUEUE_AUDIENCE_COMPUTE = 'engagement-audience-compute' as const;

export type AudienceComputeJobData = {
  audienceId: number;
};
export type AudienceComputeJobResult = {
  membersAdded: number;
  membersRemoved: number;
  totalMembers: number;
  durationMs: number;
};

// ─── Broadcast pipeline ─────────────────────────────────────────────────────
export const QUEUE_BROADCAST_LAUNCH = 'engagement-broadcast-launch' as const;
export const QUEUE_BROADCAST_BATCH = 'engagement-broadcast-batch' as const;
export const QUEUE_BROADCAST_SEND = 'engagement-broadcast-send' as const;

export type BroadcastLaunchJobData = { broadcastId: number };
export type BroadcastBatchJobData = {
  broadcastId: number;
  // Snapshot offset window. The launch job fans out one batch per N rows.
  offsetId: string;            // BroadcastDelivery.id cursor (BigInt as string)
  limit: number;
};
export type BroadcastSendJobData = {
  broadcastDeliveryId: string; // BigInt as string
};

// ─── SES quota poller ──────────────────────────────────────────────────────
export const QUEUE_SES_QUOTA_POLL = 'engagement-ses-quota-poll' as const;
export type SesQuotaPollJobData = Record<string, never>;

// ─── Deliverability rollup ─────────────────────────────────────────────────
// Hourly job. Computes 24h complaint / bounce rates, raises or resolves
// DeliverabilityAlert rows, and writes a snapshot to
// Setting('deliverability.snapshot') for the dashboard tile.
export const QUEUE_DELIVERABILITY_ROLLUP = 'engagement-deliverability-rollup' as const;
export type DeliverabilityRollupJobData = Record<string, never>;

// ─── CRM activity push (Phase 2 — defined here for forward-compat) ─────────
export const QUEUE_CRM_ACTIVITY_PUSH = 'engagement-crm-activity-push' as const;
export type CrmActivityPushJobData = {
  deliveryId: string;          // BigInt as string
  event: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'unsubscribed' | 'failed';
};

// ─── Phase 2 journey runner ───────────────────────────────────────────────
export const QUEUE_JOURNEY_TICK = 'engagement-journey-tick' as const;
export const QUEUE_JOURNEY_WAIT_SWEEP = 'engagement-journey-wait-sweep' as const;
export const QUEUE_JOURNEY_TRIGGER = 'engagement-journey-trigger' as const;
// Recovers runs stuck in 'running' without a scheduled tick — typically
// from a worker crash mid-trigger before the initial tick was enqueued.
export const QUEUE_JOURNEY_STUCK_RUN_SWEEP = 'engagement-journey-stuck-run-sweep' as const;

// Tick: advance a single run by one node (or hot-loop a few non-delayed
// nodes). Idempotent at the worker entry point via expectedNodeId +
// expectedVersionId — duplicate jobs return without acting.
export type JourneyTickJobData = {
  runId: string;               // BigInt as string
  expectedNodeId: string;
  expectedVersionId: number;
};

// Trigger: dual-purpose dispatch.
//   - 'audience-enter' / 'event' may start a new JourneyRun (entry-node match).
//   - 'audience-enter' / 'audience-exit' / 'event' may also resume a waiting
//     run (matching JourneyWait).
// 'audience-exit' is wait-only — exiting an audience doesn't start a run.
// Run-start dedup: (journeyId, subscriberId, versionId) UNIQUE on JourneyRun.
// Wait-resume dedup: runId UNIQUE on JourneyWait.
export type JourneyTriggerJobData =
  | { kind: 'audience-enter'; audienceId: number; subscriberId: string }
  | { kind: 'audience-exit'; audienceId: number; subscriberId: string }
  | {
      kind: 'event';
      event: string;
      subscriberId: string;
      eventMessageId: string;
      // Properties from the event row, used for WaitFor predicate evaluation
      // and (later) EventEntry predicate evaluation. Null when absent.
      properties?: Record<string, unknown> | null;
    };

// ─── Smoke-test queue (env-gated; mirrors CRM `generate`) ──────────────────
export const QUEUE_GENERATE = 'engagement-generate' as const;
export type GenerateJobData = { sleepMs?: number; label?: string };
export type GenerateJobResult = { generated: string; completedAt: string; label?: string };
