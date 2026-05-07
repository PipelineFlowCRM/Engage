// Custom xyflow nodes — one per journey node type. Each renders a card
// with a 4px colored left accent bar + a colored icon container, per
// BRAND.md's workflow node language. Channel-coded by message type.

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import {
  Zap, Filter, Clock, Mail, Hourglass, Split, Square,
} from 'lucide-react';
import type { JourneyNodeData } from '@/lib/journeyGraph';
import { HANDLES } from '@/lib/journeyGraph';
import { cn } from '@/lib/utils';

// Channel/node accents (raw hex; xyflow nodes render outside the React
// theme tree where Tailwind tokens still resolve, but inline color is
// safer for the SVG handles).
const ACCENT = {
  trigger: { bar: 'bg-channel-trigger', iconBg: 'bg-channel-trigger-tint', iconFg: 'text-channel-trigger', handle: '!bg-channel-trigger' },
  email:   { bar: 'bg-channel-email',   iconBg: 'bg-channel-email-tint',   iconFg: 'text-channel-email',   handle: '!bg-channel-email'   },
  wait:    { bar: 'bg-node-wait',       iconBg: 'bg-slate-100',            iconFg: 'text-node-wait',       handle: '!bg-node-wait'       },
  branch:  { bar: 'bg-node-branch',     iconBg: 'bg-slate-100',            iconFg: 'text-node-branch',     handle: '!bg-node-branch'     },
  exit:    { bar: 'bg-node-exit',       iconBg: 'bg-destructive/10',       iconFg: 'text-node-exit',       handle: '!bg-node-exit'       },
} as const;

function NodeShell({
  icon: Icon, accent, label, body, selected, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent: keyof typeof ACCENT;
  label: string;
  body: React.ReactNode;
  selected?: boolean;
  children?: React.ReactNode;
}) {
  const a = ACCENT[accent];
  return (
    <div
      className={cn(
        'relative min-w-[220px] overflow-hidden rounded-md border bg-card text-card-foreground shadow-sm transition-shadow',
        selected ? 'ring-2 ring-ring shadow-elevated' : 'border-border/80',
      )}
    >
      {/* 4px accent bar */}
      <div className={cn('absolute inset-y-0 left-0 w-1', a.bar)} />
      <Handle type="target" position={Position.Top} id={HANDLES.target} className="!h-2 !w-2 !bg-muted-foreground" />
      <div className="flex items-center gap-2.5 px-3 pl-4 pt-2.5">
        <div className={cn('grid h-6 w-6 place-items-center rounded-md', a.iconBg)}>
          <Icon className={cn('h-3.5 w-3.5', a.iconFg)} />
        </div>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="px-3 pl-4 pb-3 pt-1.5 text-xs">{body}</div>
      {children}
    </div>
  );
}

export function EventEntryNode({ data, selected }: NodeProps<Node<JourneyNodeData>>) {
  const n = data.node as Extract<JourneyNodeData['node'], { type: 'EventEntry' }>;
  return (
    <NodeShell
      icon={Zap}
      accent="trigger"
      label="Event entry"
      body={<div><span className="text-muted-foreground">on </span><span className="font-mono">{n.event}</span></div>}
      selected={selected}
    >
      <Handle type="source" position={Position.Bottom} id={HANDLES.next} className={cn('!h-2 !w-2', ACCENT.trigger.handle)} />
    </NodeShell>
  );
}

export function SegmentEntryNode({ data, selected }: NodeProps<Node<JourneyNodeData>>) {
  const n = data.node as Extract<JourneyNodeData['node'], { type: 'SegmentEntry' }>;
  return (
    <NodeShell
      icon={Filter}
      accent="trigger"
      label="Segment entry"
      body={<div><span className="text-muted-foreground">audience </span><span className="font-mono">#{n.audienceId}</span></div>}
      selected={selected}
    >
      <Handle type="source" position={Position.Bottom} id={HANDLES.next} className={cn('!h-2 !w-2', ACCENT.trigger.handle)} />
    </NodeShell>
  );
}

export function DelayNode({ data, selected }: NodeProps<Node<JourneyNodeData>>) {
  const n = data.node as Extract<JourneyNodeData['node'], { type: 'Delay' }>;
  return (
    <NodeShell
      icon={Clock}
      accent="wait"
      label="Delay"
      body={
        <div>
          {n.delay.kind === 'seconds'
            ? <span><span className="text-muted-foreground">wait </span>{n.delay.seconds}s</span>
            : <span><span className="text-muted-foreground">at </span>{String(n.delay.hour).padStart(2, '0')}:{String(n.delay.minute).padStart(2, '0')} <span className="text-muted-foreground">local</span></span>}
        </div>
      }
      selected={selected}
    >
      <Handle type="source" position={Position.Bottom} id={HANDLES.next} className={cn('!h-2 !w-2', ACCENT.wait.handle)} />
    </NodeShell>
  );
}

export function MessageNode({ data, selected }: NodeProps<Node<JourneyNodeData>>) {
  const n = data.node as Extract<JourneyNodeData['node'], { type: 'Message' }>;
  return (
    <NodeShell
      icon={Mail}
      accent="email"
      label="Email"
      body={<div><span className="text-muted-foreground">template </span><span className="font-mono">#{n.templateId}</span></div>}
      selected={selected}
    >
      <Handle type="source" position={Position.Bottom} id={HANDLES.next} className={cn('!h-2 !w-2', ACCENT.email.handle)} />
    </NodeShell>
  );
}

export function WaitForNode({ data, selected }: NodeProps<Node<JourneyNodeData>>) {
  const n = data.node as Extract<JourneyNodeData['node'], { type: 'WaitFor' }>;
  const sig =
    n.signal.kind === 'event'
      ? `event ${n.signal.event}`
      : `audience #${n.signal.audienceId} ${n.signal.kind === 'audience-enter' ? 'enter' : 'exit'}`;
  return (
    <NodeShell
      icon={Hourglass}
      accent="wait"
      label="Wait for"
      body={
        <>
          <div>{sig}</div>
          <div className="text-muted-foreground">timeout {n.timeoutSeconds}s</div>
        </>
      }
      selected={selected}
    >
      <Handle type="source" position={Position.Bottom} id={HANDLES.next} className="!h-2 !w-2 !bg-success" />
      <Handle type="source" position={Position.Right} id={HANDLES.timeoutNext} className="!h-2 !w-2 !bg-warning" />
    </NodeShell>
  );
}

export function SegmentSplitNode({ data, selected }: NodeProps<Node<JourneyNodeData>>) {
  const n = data.node as Extract<JourneyNodeData['node'], { type: 'SegmentSplit' }>;
  return (
    <NodeShell
      icon={Split}
      accent="branch"
      label="Segment split"
      body={<div><span className="text-muted-foreground">audience </span><span className="font-mono">#{n.audienceId}</span></div>}
      selected={selected}
    >
      <Handle type="source" position={Position.Bottom} id={HANDLES.trueNext} style={{ left: '30%' }} className="!h-2 !w-2 !bg-success" />
      <Handle type="source" position={Position.Bottom} id={HANDLES.falseNext} style={{ left: '70%' }} className="!h-2 !w-2 !bg-destructive" />
    </NodeShell>
  );
}

export function ExitNode({ data, selected }: NodeProps<Node<JourneyNodeData>>) {
  const n = data.node as Extract<JourneyNodeData['node'], { type: 'Exit' }>;
  return (
    <NodeShell
      icon={Square}
      accent="exit"
      label="Exit"
      body={<div className="text-muted-foreground">{n.reason ?? '(no reason)'}</div>}
      selected={selected}
    />
  );
}

export const journeyNodeTypes = {
  EventEntry: EventEntryNode,
  SegmentEntry: SegmentEntryNode,
  Delay: DelayNode,
  Message: MessageNode,
  WaitFor: WaitForNode,
  SegmentSplit: SegmentSplitNode,
  Exit: ExitNode,
};
