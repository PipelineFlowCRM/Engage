// Right-sidebar config form. Renders fields specific to the selected
// node's type. All edits flow through one onChange callback that
// produces a new JourneyNode; the editor patches it back into xyflow's
// node.data.

import { useRef } from 'react';
import type { JourneyNode } from '@pipelineflow-engagement/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Trash2, Plus, X } from 'lucide-react';

type TraitSplitNode = Extract<JourneyNode, { type: 'TraitSplit' }>;
type TraitPredicate = TraitSplitNode['predicates'][number];

type PredicateOperator =
  | 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'exists' | 'notExists' | 'contains' | 'notContains';

const PREDICATE_OPERATORS: PredicateOperator[] = [
  'equals', 'notEquals', 'gt', 'gte', 'lt', 'lte',
  'contains', 'notContains', 'exists', 'notExists',
];

const OPERATORS_WITHOUT_VALUE: ReadonlySet<PredicateOperator> = new Set(['exists', 'notExists']);

interface NodeConfigPanelProps {
  nodeId: string;
  node: JourneyNode;
  onChange: (next: JourneyNode) => void;
  // Drop a node from the graph. Disabled when the node is the entry node.
  onDelete?: () => void;
  isEntry?: boolean;
  // Hint references for select pickers.
  audiences: Array<{ id: number; name: string }>;
  templates: Array<{ id: number; name: string; status: string }>;
}

export function NodeConfigPanel({
  nodeId, node, onChange, onDelete, isEntry, audiences, templates,
}: NodeConfigPanelProps) {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{node.type}</div>
          <div className="font-mono text-xs text-muted-foreground truncate" title={nodeId}>
            {nodeId}
          </div>
        </div>
        {onDelete ? (
          <Button
            size="icon"
            variant="ghost"
            disabled={isEntry}
            title={isEntry ? 'Cannot delete the entry node' : 'Delete node'}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {renderFields(node, onChange, { audiences, templates })}
    </div>
  );
}

function renderFields(
  node: JourneyNode,
  onChange: (next: JourneyNode) => void,
  ctx: { audiences: Array<{ id: number; name: string }>; templates: Array<{ id: number; name: string; status: string }> },
) {
  switch (node.type) {
    case 'EventEntry':
      return (
        <div className="space-y-2">
          <Label>Event name</Label>
          <Input
            value={node.event}
            onChange={(e) => onChange({ ...node, event: e.target.value })}
            placeholder="signed_up"
          />
        </div>
      );

    case 'SegmentEntry':
      return (
        <div className="space-y-2">
          <Label>Audience</Label>
          <AudienceSelect
            value={node.audienceId}
            audiences={ctx.audiences}
            onChange={(audienceId) => onChange({ ...node, audienceId })}
          />
        </div>
      );

    case 'Delay':
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Type</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={node.delay.kind}
              onChange={(e) => {
                if (e.target.value === 'seconds') {
                  onChange({ ...node, delay: { kind: 'seconds', seconds: 86400 } });
                } else {
                  onChange({ ...node, delay: { kind: 'localized-time', hour: 9, minute: 0 } });
                }
              }}
            >
              <option value="seconds">Seconds</option>
              <option value="localized-time">Local time-of-day</option>
            </select>
          </div>
          {node.delay.kind === 'seconds' ? (
            <div className="space-y-2">
              <Label>Seconds</Label>
              <Input
                type="number"
                min={1}
                max={60 * 60 * 24 * 365}
                value={node.delay.seconds}
                onChange={(e) =>
                  onChange({ ...node, delay: { kind: 'seconds', seconds: Number(e.target.value) } })
                }
              />
              <p className="text-xs text-muted-foreground">
                {humanSeconds(node.delay.seconds)}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Hour</Label>
                <Input
                  type="number" min={0} max={23} value={node.delay.hour}
                  onChange={(e) =>
                    onChange({
                      ...node,
                      delay: {
                        kind: 'localized-time',
                        hour: Number(e.target.value),
                        minute: node.delay.kind === 'localized-time' ? node.delay.minute : 0,
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Minute</Label>
                <Input
                  type="number" min={0} max={59} value={node.delay.minute}
                  onChange={(e) =>
                    onChange({
                      ...node,
                      delay: {
                        kind: 'localized-time',
                        hour: node.delay.kind === 'localized-time' ? node.delay.hour : 9,
                        minute: Number(e.target.value),
                      },
                    })
                  }
                />
              </div>
            </div>
          )}
        </div>
      );

    case 'Message':
      return (
        <div className="space-y-2">
          <Label>Template</Label>
          <TemplateSelect
            value={node.templateId}
            templates={ctx.templates}
            onChange={(templateId) => onChange({ ...node, templateId })}
          />
        </div>
      );

    case 'WaitFor':
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Signal type</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={node.signal.kind}
              onChange={(e) => {
                const k = e.target.value as 'event' | 'audience-enter' | 'audience-exit';
                if (k === 'event') {
                  onChange({ ...node, signal: { kind: 'event', event: 'completed_onboarding' } });
                  return;
                }
                // Don't auto-fill a placeholder audienceId of 0 — it
                // would silently submit an invalid id. Require the
                // operator to pick a real one (the AudienceSelect below
                // shows an obvious "— select —" prompt) and surface a
                // validation error in the editor preview.
                const firstAudienceId = ctx.audiences[0]?.id;
                if (firstAudienceId == null) {
                  // No audiences exist yet — the operator can't sensibly
                  // pick this signal type. Bail back to event.
                  return;
                }
                onChange({ ...node, signal: { kind: k, audienceId: firstAudienceId } });
              }}
            >
              <option value="event">Event</option>
              <option value="audience-enter">Audience enter</option>
              <option value="audience-exit">Audience exit</option>
            </select>
          </div>
          {node.signal.kind === 'event' ? (
            <div className="space-y-2">
              <Label>Event name</Label>
              <Input
                value={node.signal.event}
                onChange={(e) => onChange({ ...node, signal: { kind: 'event', event: e.target.value } })}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Audience</Label>
              <AudienceSelect
                value={node.signal.audienceId}
                audiences={ctx.audiences}
                onChange={(audienceId) => {
                  // We're in the else-branch of (signal.kind === 'event'),
                  // so kind is already audience-enter | audience-exit.
                  const kind = node.signal.kind as 'audience-enter' | 'audience-exit';
                  onChange({ ...node, signal: { kind, audienceId } });
                }}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Timeout (seconds)</Label>
            <Input
              type="number" min={60} max={60 * 60 * 24 * 365}
              value={node.timeoutSeconds}
              onChange={(e) => onChange({ ...node, timeoutSeconds: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">{humanSeconds(node.timeoutSeconds)}</p>
          </div>
        </div>
      );

    case 'SegmentSplit':
      return (
        <div className="space-y-2">
          <Label>Audience</Label>
          <AudienceSelect
            value={node.audienceId}
            audiences={ctx.audiences}
            onChange={(audienceId) => onChange({ ...node, audienceId })}
          />
          <p className="text-xs text-muted-foreground">
            Branches based on whether the subscriber is in this audience at the moment of the split.
          </p>
        </div>
      );

    case 'TraitSplit':
      return <TraitSplitFields node={node} onChange={onChange} />;

    case 'Exit':
      return (
        <div className="space-y-2">
          <Label>Reason (optional)</Label>
          <Input
            value={node.reason ?? ''}
            onChange={(e) => onChange({ ...node, reason: e.target.value || undefined })}
            placeholder="completed-onboarding"
          />
        </div>
      );
  }
}

function AudienceSelect({
  value, audiences, onChange,
}: { value: number; audiences: Array<{ id: number; name: string }>; onChange: (id: number) => void }) {
  return (
    <select
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      <option value={0}>— select —</option>
      {audiences.map((a) => (
        <option key={a.id} value={a.id}>{a.name} (#{a.id})</option>
      ))}
    </select>
  );
}

function TemplateSelect({
  value, templates, onChange,
}: { value: number; templates: Array<{ id: number; name: string; status: string }>; onChange: (id: number) => void }) {
  return (
    <select
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      <option value={0}>— select —</option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
      ))}
    </select>
  );
}

// Stable, client-only id per predicate row. Decouples React reconciliation
// from the predicate's index in the array, so removing a middle row no
// longer remounts every input below it (which would steal focus and
// interrupt IME composition).
function TraitSplitFields({
  node, onChange,
}: { node: TraitSplitNode; onChange: (next: JourneyNode) => void }) {
  // useRef holds the keys; we mutate it in lockstep with predicates so a
  // re-render never sees a length mismatch. Initialized lazily from the
  // current count (handles freshly-loaded definitions without ids).
  const keysRef = useRef<string[]>([]);
  if (keysRef.current.length !== node.predicates.length) {
    // Reconcile on hydration / external resets. We can't recover stable
    // ids for pre-existing rows here (the source of truth has none) — but
    // this only triggers on load or on out-of-band changes, not on edits
    // routed through the handlers below.
    keysRef.current = node.predicates.map((_, i) => keysRef.current[i] ?? newKey());
  }

  const updatePredicates = (
    nextPredicates: TraitPredicate[],
    nextKeys: string[],
  ): void => {
    keysRef.current = nextKeys;
    onChange({ ...node, predicates: nextPredicates });
  };

  return (
    <div className="space-y-3">
      <Label>Trait predicates</Label>
      <p className="text-xs text-muted-foreground">
        All predicates must match (AND) for the run to take the <span className="font-mono text-success">true</span> branch.
        Evaluated against subscriber traits at the moment of the split — no audience round-trip.
      </p>
      <div className="space-y-2">
        {node.predicates.map((p, i) => {
          const uiKey = keysRef.current[i]!;
          const operatorTakesValue = !OPERATORS_WITHOUT_VALUE.has(p.operator);
          return (
            <div key={uiKey} className="space-y-1.5 rounded-md border border-border/60 bg-background/50 p-2">
              <div className="flex items-start gap-1.5">
                <Input
                  className="flex-1 font-mono text-xs"
                  value={p.key}
                  maxLength={255}
                  placeholder="trait_key"
                  onChange={(e) => {
                    const value = e.target.value;
                    updatePredicates(
                      node.predicates.map((pp, j) => (j === i ? { ...pp, key: value } : pp)),
                      keysRef.current,
                    );
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  title="Remove predicate"
                  disabled={node.predicates.length <= 1}
                  onClick={() => {
                    if (node.predicates.length <= 1) return;
                    updatePredicates(
                      node.predicates.filter((_, j) => j !== i),
                      keysRef.current.filter((_, j) => j !== i),
                    );
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={p.operator}
                  onChange={(e) => {
                    const op = e.target.value as PredicateOperator;
                    const nextPreds = node.predicates.map((pp, j) => {
                      if (j !== i) return pp;
                      // Drop value when switching to a no-value operator,
                      // and don't carry an empty string back over when
                      // switching to one that takes a value (`equals ""`
                      // would silently match missing traits).
                      if (OPERATORS_WITHOUT_VALUE.has(op)) {
                        return { key: pp.key, operator: op };
                      }
                      return { key: pp.key, operator: op, value: pp.value ?? undefined };
                    });
                    updatePredicates(nextPreds, keysRef.current);
                  }}
                >
                  {PREDICATE_OPERATORS.map((op) => (
                    <option key={op} value={op}>{op}</option>
                  ))}
                </select>
                {operatorTakesValue ? (
                  <Input
                    className="flex-1 text-xs"
                    value={p.value === undefined ? '' : String(p.value)}
                    placeholder="value"
                    onChange={(e) => {
                      const raw = e.target.value;
                      // Empty string → undefined. The evaluator treats
                      // `equals` against undefined as a non-match, which
                      // matches operator intent ("I haven't filled this
                      // in yet") far better than the prior behavior
                      // (`coerceString(undefined) === ''` matched any
                      // missing trait).
                      const value = raw === '' ? undefined : raw;
                      updatePredicates(
                        node.predicates.map((pp, j) => (j === i ? { ...pp, value } : pp)),
                        keysRef.current,
                      );
                    }}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">(no value)</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={node.predicates.length >= 20}
        onClick={() => {
          // Scaffold without a placeholder value — see the `value === ''
          // → undefined` reasoning above. Operator must explicitly fill
          // it in to get a meaningful predicate.
          updatePredicates(
            [...node.predicates, { key: '', operator: 'equals' }],
            [...keysRef.current, newKey()],
          );
        }}
      >
        <Plus className="h-3 w-3" /> Add predicate
      </Button>
    </div>
  );
}

function newKey(): string {
  // crypto.randomUUID() is everywhere modern browsers ship; for the
  // editor (only loaded behind auth in modern browsers) the polyfill
  // path isn't worth the bytes.
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function humanSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}
