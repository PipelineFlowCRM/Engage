// Bidirectional converter: JourneyDefinition (Zod-validated, server-shape)
// ↔ xyflow { nodes, edges }. The editor edits the xyflow shape; we convert
// to JourneyDefinition only at save/publish time so per-keystroke renders
// don't have to round-trip through Zod.

import type { JourneyDefinition, JourneyNode } from '@pipelineflow-engagement/shared';
import type { Edge, Node } from '@xyflow/react';
import dagre from 'dagre';

export interface JourneyNodeData extends Record<string, unknown> {
  // Mirror of the JourneyNode union, plus an id for editor convenience.
  // Stored as a flat blob keyed by xyflow node.data so React Flow doesn't
  // muddle with our internal structure.
  node: JourneyNode;
}

export interface JourneyGraph {
  nodes: Node<JourneyNodeData>[];
  edges: Edge[];
  // The id of the EventEntry/SegmentEntry node that drives the run start.
  entry: string;
}

// Edge handle ids. We use named handles so SegmentSplit's two outputs and
// WaitFor's signal/timeout outputs are unambiguous.
export const HANDLES = {
  target: 'target',
  next: 'next',
  trueNext: 'trueNext',
  falseNext: 'falseNext',
  timeoutNext: 'timeoutNext',
} as const;

// ─── definition → graph ────────────────────────────────────────────────────

export function definitionToGraph(def: JourneyDefinition): JourneyGraph {
  const nodes: Node<JourneyNodeData>[] = Object.entries(def.nodes).map(([id, node]) => ({
    id,
    type: node.type,
    position: { x: 0, y: 0 },         // dagre fills these in
    data: { node },
  }));
  const edges: Edge[] = [];
  for (const [id, node] of Object.entries(def.nodes)) {
    if (node.type === 'SegmentSplit') {
      edges.push(makeEdge(id, node.trueNext, HANDLES.trueNext));
      edges.push(makeEdge(id, node.falseNext, HANDLES.falseNext));
    } else if (node.type === 'WaitFor') {
      edges.push(makeEdge(id, node.next, HANDLES.next));
      if (node.timeoutNext) {
        edges.push(makeEdge(id, node.timeoutNext, HANDLES.timeoutNext));
      }
    } else if (node.type !== 'Exit') {
      // EventEntry, SegmentEntry, Delay, Message — single `next`.
      edges.push(makeEdge(id, (node as { next: string }).next, HANDLES.next));
    }
  }
  return { nodes: applyLayout(nodes, edges), edges, entry: def.entry };
}

function makeEdge(source: string, target: string, sourceHandle: string): Edge {
  return {
    id: `${source}-${sourceHandle}-${target}`,
    source,
    target,
    sourceHandle,
    targetHandle: HANDLES.target,
    // SegmentSplit branches and WaitFor timeout get their own colour so
    // operators can read the graph without clicking each edge.
    label: handleLabel(sourceHandle),
    type: 'default',
  };
}

function handleLabel(h: string): string {
  if (h === HANDLES.trueNext) return 'true';
  if (h === HANDLES.falseNext) return 'false';
  if (h === HANDLES.timeoutNext) return 'timeout';
  return '';
}

// ─── graph → definition ────────────────────────────────────────────────────

export interface ConvertResult {
  ok: true;
  definition: JourneyDefinition;
}
export interface ConvertError {
  ok: false;
  errors: string[];
}

export function graphToDefinition(
  nodes: Node<JourneyNodeData>[],
  edges: Edge[],
  entry: string,
): ConvertResult | ConvertError {
  const errors: string[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(entry)) {
    errors.push(`entry node '${entry}' is not in the graph`);
  }

  // Group outgoing edges by source node + handle.
  const outgoing = new Map<string, Map<string, string>>();
  for (const e of edges) {
    if (!nodeIds.has(e.target)) {
      errors.push(`edge ${e.id} target '${e.target}' is missing`);
      continue;
    }
    const sourceMap = outgoing.get(e.source) ?? new Map();
    const handle = e.sourceHandle ?? HANDLES.next;
    if (sourceMap.has(handle)) {
      errors.push(`node '${e.source}' has multiple edges from handle '${handle}'`);
      continue;
    }
    sourceMap.set(handle, e.target);
    outgoing.set(e.source, sourceMap);
  }

  // Reconstruct JourneyNode[] by patching `next`/`trueNext`/etc from edges.
  const reconstructed: Record<string, JourneyNode> = {};
  for (const n of nodes) {
    const original = n.data.node;
    const out = outgoing.get(n.id) ?? new Map();
    reconstructed[n.id] = patchTargets(original, out, errors, n.id);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, definition: { entry, nodes: reconstructed } };
}

function patchTargets(
  node: JourneyNode,
  out: Map<string, string>,
  errors: string[],
  nodeId: string,
): JourneyNode {
  switch (node.type) {
    case 'Exit':
      // No outgoing edges expected. Warn if any.
      if (out.size > 0) errors.push(`Exit node '${nodeId}' has outgoing edges`);
      return node;
    case 'SegmentSplit': {
      const trueNext = out.get(HANDLES.trueNext);
      const falseNext = out.get(HANDLES.falseNext);
      if (!trueNext) errors.push(`SegmentSplit '${nodeId}' missing 'true' edge`);
      if (!falseNext) errors.push(`SegmentSplit '${nodeId}' missing 'false' edge`);
      return { ...node, trueNext: trueNext ?? '', falseNext: falseNext ?? '' };
    }
    case 'WaitFor': {
      const next = out.get(HANDLES.next);
      const timeoutNext = out.get(HANDLES.timeoutNext);
      if (!next) errors.push(`WaitFor '${nodeId}' missing 'next' edge`);
      return {
        ...node,
        next: next ?? '',
        ...(timeoutNext ? { timeoutNext } : { timeoutNext: undefined }),
      };
    }
    default: {
      const next = out.get(HANDLES.next);
      if (!next) errors.push(`${node.type} '${nodeId}' missing 'next' edge`);
      return { ...node, next: next ?? '' } as JourneyNode;
    }
  }
}

// ─── dagre auto-layout ─────────────────────────────────────────────────────

const NODE_W = 220;
const NODE_H = 90;

export function applyLayout(
  nodes: Node<JourneyNodeData>[],
  edges: Edge[],
): Node<JourneyNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', ranksep: 64, nodesep: 36 });
  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: (pos?.x ?? 0) - NODE_W / 2, y: (pos?.y ?? 0) - NODE_H / 2 },
    };
  });
}

// ─── new-graph helpers ────────────────────────────────────────────────────

let nextNodeIdCounter = 0;
export function newNodeId(prefix: string): string {
  // Combine a monotonic local counter, the current ms epoch, and 4 bytes
  // of entropy. The randomness matters across hot-reload cycles (where
  // the counter resets) and across cloned-journey saves where we don't
  // want timestamp-prefix collisions.
  nextNodeIdCounter += 1;
  const rand = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${prefix}-${Date.now().toString(36)}-${nextNodeIdCounter}-${rand}`;
}

export function emptyJourneyGraph(): JourneyGraph {
  const entryId = 'entry';
  const exitId = 'exit';
  const entry: JourneyNode = { type: 'EventEntry', event: 'signed_up', next: exitId };
  const exit: JourneyNode = { type: 'Exit' };
  // Single edge instance — the previous version constructed two distinct
  // Edge objects with the same id, one passed to applyLayout and one
  // returned. xyflow's reconciliation tolerates that but it left the
  // editor's `edges` state and the layout-input out of sync.
  const edges = [makeEdge(entryId, exitId, HANDLES.next)];
  return {
    entry: entryId,
    nodes: applyLayout(
      [
        { id: entryId, type: 'EventEntry', position: { x: 0, y: 0 }, data: { node: entry } },
        { id: exitId, type: 'Exit', position: { x: 0, y: 200 }, data: { node: exit } },
      ],
      edges,
    ),
    edges,
  };
}
