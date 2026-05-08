// Read-only visualization of a JourneyDefinition. Reuses the editor's
// custom node components and dagre layout, but disables interaction and
// overlays live run counts so an operator can see structure + activity at
// a glance.

import { useMemo } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { JourneyDefinition } from '@pipelineflow-engagement/shared';
import { definitionToGraph, type JourneyNodeData } from '@/lib/journeyGraph';
import { journeyNodeTypes } from '@/components/journey/nodes';

export interface JourneyGraphViewProps {
  definition: JourneyDefinition;
  // Map of nodeId → number of subscribers currently sitting on that node.
  // Rendered as a small pill in the top-right corner of each node.
  runCounts?: Record<string, number>;
  className?: string;
}

interface ViewNodeData extends JourneyNodeData {
  runCount?: number;
}

// Wrap each editor node component so we can overlay a "N here" pill in the
// top-right corner without forking the eight node renderers. xyflow nodes
// are absolutely-positioned by the runtime, so an extra relative wrapper
// here is fine — Handle children inside the inner node still anchor to the
// inner NodeShell.
type NodeRenderer<T extends JourneyNodeData> = (
  props: NodeProps<Node<T>>,
) => React.ReactElement;

function withRunCount(Inner: NodeRenderer<JourneyNodeData>): NodeRenderer<ViewNodeData> {
  return function WrappedNode(props) {
    const count = props.data.runCount ?? 0;
    return (
      <div className="relative">
        <Inner {...props} />
        {count > 0 ? (
          <div
            className="pointer-events-none absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-semibold text-brand-foreground shadow-sm"
            title={`${count} subscriber${count === 1 ? '' : 's'} currently on this node`}
          >
            {count}
          </div>
        ) : null}
      </div>
    );
  };
}

// Object.fromEntries widens to Record<string, ...>; cast back to the
// original key set so xyflow gets a stable nodeTypes reference. The inner
// components only read `data.node`, which is identical on both shapes.
const readOnlyNodeTypes = Object.fromEntries(
  Object.entries(journeyNodeTypes).map(([k, v]) => [
    k,
    withRunCount(v as NodeRenderer<JourneyNodeData>),
  ]),
) as typeof journeyNodeTypes;

function summarize(definition: JourneyDefinition): string {
  const count = Object.keys(definition.nodes).length;
  const entry = definition.nodes[definition.entry];
  const entryDesc =
    entry?.type === 'EventEntry'
      ? `event '${entry.event}'`
      : entry?.type === 'SegmentEntry'
        ? `audience #${entry.audienceId}`
        : 'unknown trigger';
  return `Journey map with ${count} node${count === 1 ? '' : 's'}, entered on ${entryDesc}`;
}

export function JourneyGraphView({
  definition,
  runCounts,
  className,
}: JourneyGraphViewProps) {
  // Layout is expensive (dagre); keep it keyed only on the definition so
  // the 5s run-count poll doesn't trigger a full re-layout.
  const layout = useMemo(() => definitionToGraph(definition), [definition]);

  const nodes = useMemo<Node<ViewNodeData>[]>(
    () =>
      layout.nodes.map((n) => ({
        ...n,
        data: { ...n.data, runCount: runCounts?.[n.id] ?? 0 },
        draggable: false,
        connectable: false,
      })),
    [layout, runCounts],
  );

  const edges = useMemo<Edge[]>(
    () => layout.edges.map((e) => ({ ...e, focusable: false })),
    [layout],
  );

  const ariaLabel = useMemo(() => summarize(definition), [definition]);

  return (
    <ReactFlowProvider>
      <div className={className} role="img" aria-label={ariaLabel}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={readOnlyNodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.25}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          className="!bg-muted/30"
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} className="!shadow-sm" />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
