// Custom xyflow nodes — one per journey node type. Each renders a small
// card with an icon, the type label, the key parameter, and the appropriate
// source/target handles.
//
// All nodes share a target handle on the top. Source handles vary:
//   - EventEntry / SegmentEntry / Delay / Message: single 'next' on bottom
//   - SegmentSplit: 'trueNext' (left) + 'falseNext' (right)
//   - WaitFor: 'next' (bottom) + 'timeoutNext' (right)
//   - Exit: no source (terminal)

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import {
  Zap, Filter, Clock, Mail, Hourglass, Split, Square,
} from 'lucide-react';
import type { JourneyNodeData } from '@/lib/journeyGraph';
import { HANDLES } from '@/lib/journeyGraph';
import { cn } from '@/lib/utils';

const targetHandle = (
  <Handle type="target" position={Position.Top} id={HANDLES.target} className="!h-2 !w-2 !bg-muted-foreground" />
);

function NodeShell({
  icon: Icon, color, label, body, selected, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: string;
  body: React.ReactNode;
  selected?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'min-w-[200px] rounded-md border bg-card text-card-foreground shadow-sm transition-shadow',
        selected ? 'ring-2 ring-ring shadow-md' : 'border-border/80',
      )}
    >
      {targetHandle}
      <div className={cn('flex items-center gap-2 rounded-t-md px-3 py-2 text-xs font-semibold', color)}>
        <Icon className="h-4 w-4 shrink-0" />
        <span className="uppercase tracking-wider">{label}</span>
      </div>
      <div className="px-3 py-2 text-xs">{body}</div>
      {children}
    </div>
  );
}

export function EventEntryNode({ data, selected }: NodeProps<Node<JourneyNodeData>>) {
  const n = data.node as Extract<JourneyNodeData['node'], { type: 'EventEntry' }>;
  return (
    <NodeShell
      icon={Zap}
      color="bg-brand/15 text-brand-foreground"
      label="Event entry"
      body={<div><span className="text-muted-foreground">on</span> <span className="font-mono">{n.event}</span></div>}
      selected={selected}
    >
      <Handle type="source" position={Position.Bottom} id={HANDLES.next} className="!h-2 !w-2 !bg-brand" />
    </NodeShell>
  );
}

export function SegmentEntryNode({ data, selected }: NodeProps<Node<JourneyNodeData>>) {
  const n = data.node as Extract<JourneyNodeData['node'], { type: 'SegmentEntry' }>;
  return (
    <NodeShell
      icon={Filter}
      color="bg-brand/15 text-brand-foreground"
      label="Segment entry"
      body={<div><span className="text-muted-foreground">audience</span> <span className="font-mono">#{n.audienceId}</span></div>}
      selected={selected}
    >
      <Handle type="source" position={Position.Bottom} id={HANDLES.next} className="!h-2 !w-2 !bg-brand" />
    </NodeShell>
  );
}

export function DelayNode({ data, selected }: NodeProps<Node<JourneyNodeData>>) {
  const n = data.node as Extract<JourneyNodeData['node'], { type: 'Delay' }>;
  return (
    <NodeShell
      icon={Clock}
      color="bg-secondary text-secondary-foreground"
      label="Delay"
      body={
        <div>
          {n.delay.kind === 'seconds'
            ? <span><span className="text-muted-foreground">wait</span> {n.delay.seconds}s</span>
            : <span><span className="text-muted-foreground">at</span> {String(n.delay.hour).padStart(2, '0')}:{String(n.delay.minute).padStart(2, '0')} <span className="text-muted-foreground">local</span></span>}
        </div>
      }
      selected={selected}
    >
      <Handle type="source" position={Position.Bottom} id={HANDLES.next} className="!h-2 !w-2 !bg-foreground" />
    </NodeShell>
  );
}

export function MessageNode({ data, selected }: NodeProps<Node<JourneyNodeData>>) {
  const n = data.node as Extract<JourneyNodeData['node'], { type: 'Message' }>;
  return (
    <NodeShell
      icon={Mail}
      color="bg-success/15 text-success-foreground"
      label="Message"
      body={<div><span className="text-muted-foreground">template</span> <span className="font-mono">#{n.templateId}</span></div>}
      selected={selected}
    >
      <Handle type="source" position={Position.Bottom} id={HANDLES.next} className="!h-2 !w-2 !bg-success" />
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
      color="bg-warning/15 text-warning-foreground"
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
      color="bg-secondary text-secondary-foreground"
      label="Segment split"
      body={<div><span className="text-muted-foreground">audience</span> <span className="font-mono">#{n.audienceId}</span></div>}
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
      color="bg-muted text-muted-foreground"
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
