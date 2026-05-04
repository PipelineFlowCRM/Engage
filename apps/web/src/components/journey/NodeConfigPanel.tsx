// Right-sidebar config form. Renders fields specific to the selected
// node's type. All edits flow through one onChange callback that
// produces a new JourneyNode; the editor patches it back into xyflow's
// node.data.

import type { JourneyNode } from '@pipelineflow-engagement/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

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
                } else {
                  onChange({ ...node, signal: { kind: k, audienceId: ctx.audiences[0]?.id ?? 0 } });
                }
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

function humanSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}
