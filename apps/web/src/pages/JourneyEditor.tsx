import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  addEdge, applyEdgeChanges, applyNodeChanges,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  journeyDefinitionSchema,
  type JourneyDefinition,
  type JourneyNode,
} from '@pipelineflow-engagement/shared';
import { api } from '@/lib/api';
import {
  HANDLES, applyLayout, definitionToGraph, emptyJourneyGraph,
  graphToDefinition, newNodeId, type JourneyNodeData,
} from '@/lib/journeyGraph';
import { journeyNodeTypes } from '@/components/journey/nodes';
import { NodeConfigPanel } from '@/components/journey/NodeConfigPanel';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Wand2 } from 'lucide-react';

export function JourneyEditor() {
  // ReactFlowProvider needed because the editor reads useReactFlow() in
  // toolbar buttons (for fitView after auto-layout) and Controls.
  return (
    <ReactFlowProvider>
      <JourneyEditorInner />
    </ReactFlowProvider>
  );
}

function JourneyEditorInner() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = idParam ? Number(idParam) : null;
  const isNew = id == null;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nodes, setNodes] = useState<Node<JourneyNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [entryId, setEntryId] = useState<string>('entry');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const audiences = useQuery({
    queryKey: ['audiences'],
    queryFn: () => api.get<{ audiences: Array<{ id: number; name: string }> }>('/audiences'),
  });
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ templates: Array<{ id: number; name: string; status: string }> }>('/templates'),
  });

  const existing = useQuery({
    queryKey: ['journey', id],
    queryFn: () =>
      api.get<{
        journey: {
          name: string;
          description: string | null;
          currentVersion: { definition: unknown } | null;
          versions: Array<{ id: number; version: number; definition: unknown; publishedAt: string }>;
        };
      }>(`/journeys/${id}`),
    enabled: Boolean(id),
  });

  // Hydrate from server. New form: seed with empty entry → exit graph. Edit
  // form: prefer the latest saved version (= working draft) over current.
  useEffect(() => {
    if (hydrated) return;
    if (isNew) {
      const g = emptyJourneyGraph();
      setNodes(g.nodes);
      setEdges(g.edges);
      setEntryId(g.entry);
      setHydrated(true);
      return;
    }
    if (existing.data?.journey) {
      const j = existing.data.journey;
      setName(j.name);
      setDescription(j.description ?? '');
      const def = j.versions[0]?.definition ?? j.currentVersion?.definition;
      if (def) {
        const parsed = journeyDefinitionSchema.safeParse(def);
        if (parsed.success) {
          const g = definitionToGraph(parsed.data);
          setNodes(g.nodes);
          setEdges(g.edges);
          setEntryId(g.entry);
        } else {
          toast.error('Stored definition failed to parse — opening as a fresh draft');
          const g = emptyJourneyGraph();
          setNodes(g.nodes);
          setEdges(g.edges);
          setEntryId(g.entry);
        }
      }
      setHydrated(true);
    }
  }, [existing.data, isNew, hydrated]);

  // ─── xyflow handlers ────────────────────────────────────────────────────
  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((ns) => applyNodeChanges(changes, ns) as Node<JourneyNodeData>[]),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  );
  const onConnect = useCallback((connection: Connection) => {
    setEdges((es) =>
      addEdge(
        {
          ...connection,
          targetHandle: connection.targetHandle ?? HANDLES.target,
        },
        es,
      ),
    );
  }, []);

  const updateNodeData = useCallback((nodeId: string, next: JourneyNode) => {
    setNodes((ns) =>
      ns.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, node: next }, type: next.type }
          : n,
      ),
    );
  }, []);

  const addNode = useCallback((type: JourneyNode['type']) => {
    const newId = newNodeId(type.toLowerCase());
    const node = scaffoldFor(type);
    setNodes((ns) => [
      ...ns,
      {
        id: newId,
        type,
        position: { x: 100 + Math.random() * 60, y: 100 + ns.length * 30 },
        data: { node },
      },
    ]);
    setSelectedNodeId(newId);
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selectedNodeId) return;
    if (selectedNodeId === entryId) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedNodeId));
    setEdges((es) => es.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  }, [selectedNodeId, entryId]);

  const autoLayout = useCallback(() => {
    setNodes((ns) => applyLayout(ns, edges));
  }, [edges]);

  // ─── save / publish ────────────────────────────────────────────────────
  const saveDef = useMemo(() => {
    const conv = graphToDefinition(nodes, edges, entryId);
    if (conv.ok) return { definition: conv.definition, errors: [] as string[] };
    return { definition: null as JourneyDefinition | null, errors: conv.errors };
  }, [nodes, edges, entryId]);

  const save = useMutation({
    mutationFn: () => {
      const body: { name: string; description: string | null; definition?: JourneyDefinition } = {
        name,
        description: description || null,
      };
      if (saveDef.definition) body.definition = saveDef.definition;
      return isNew ? api.post('/journeys', body) : api.patch(`/journeys/${id}`, body);
    },
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['journeys'] }); navigate('/journeys'); },
    onError: (err: Error) => toast.error(err.message),
  });

  const publish = useMutation({
    mutationFn: () => {
      if (!saveDef.definition) throw new Error('Definition has errors');
      const v = journeyDefinitionSchema.safeParse(saveDef.definition);
      if (!v.success) {
        setValidationErrors(v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
        throw new Error('Definition failed validation');
      }
      return api.post(`/journeys/${id}/publish`, { definition: v.data });
    },
    onSuccess: () => { toast.success('Published'); qc.invalidateQueries({ queryKey: ['journeys'] }); navigate('/journeys'); },
    onError: (err: Error) => toast.error(err.message),
  });

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title={isNew ? 'New journey' : 'Edit journey'}
        description="Drag handles to connect nodes. The right panel edits the selected node."
        actions={
          <>
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save draft'}
            </Button>
            {!isNew ? (
              <Button
                variant="brand"
                disabled={publish.isPending || saveDef.errors.length > 0}
                onClick={() => publish.mutate()}
                title={saveDef.errors[0] ?? 'Publish current graph as a new version'}
              >
                {publish.isPending ? 'Publishing…' : 'Publish'}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex border-b border-border/60 px-6 py-3 gap-3 items-end">
        <div className="space-y-1.5 flex-1 max-w-md">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5 flex-1 max-w-md">
          <Label>Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[1fr_320px] overflow-hidden">
        <div className="relative">
          <Toolbar onAdd={addNode} onAutoLayout={autoLayout} />
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_e, n) => setSelectedNodeId(n.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            nodeTypes={journeyNodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} />
            <Controls />
            <MiniMap pannable zoomable className="!bg-card" />
          </ReactFlow>

          {(saveDef.errors.length > 0 || validationErrors.length > 0) && (
            <div className="absolute bottom-4 left-4 max-w-md rounded border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <div className="mb-1 font-semibold">Graph issues</div>
              <ul className="space-y-0.5">
                {[...saveDef.errors, ...validationErrors].slice(0, 6).map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <aside className="overflow-y-auto border-l border-border/60 bg-card/40">
          {selectedNode ? (
            <NodeConfigPanel
              nodeId={selectedNode.id}
              node={selectedNode.data.node}
              onChange={(next) => updateNodeData(selectedNode.id, next)}
              onDelete={selectedNode.id === entryId ? undefined : deleteSelected}
              isEntry={selectedNode.id === entryId}
              audiences={audiences.data?.audiences ?? []}
              templates={templates.data?.templates ?? []}
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              Select a node to edit it. Use the toolbar to add new nodes.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Toolbar({
  onAdd, onAutoLayout,
}: { onAdd: (t: JourneyNode['type']) => void; onAutoLayout: () => void }) {
  return (
    <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2 rounded-md border border-border/80 bg-card/95 p-2 shadow-soft backdrop-blur">
      <NodeTypeButton type="Delay" onAdd={onAdd} />
      <NodeTypeButton type="Message" onAdd={onAdd} />
      <NodeTypeButton type="WaitFor" onAdd={onAdd} label="Wait for" />
      <NodeTypeButton type="SegmentSplit" onAdd={onAdd} label="Split" />
      <NodeTypeButton type="Exit" onAdd={onAdd} />
      <Button size="sm" variant="ghost" onClick={onAutoLayout}>
        <Wand2 className="h-4 w-4" /> Auto-layout
      </Button>
    </div>
  );
}

function NodeTypeButton({
  type, label, onAdd,
}: { type: JourneyNode['type']; label?: string; onAdd: (t: JourneyNode['type']) => void }) {
  return (
    <Button size="sm" variant="outline" onClick={() => onAdd(type)}>
      <Plus className="h-3 w-3" /> {label ?? type}
    </Button>
  );
}

function scaffoldFor(type: JourneyNode['type']): JourneyNode {
  switch (type) {
    case 'EventEntry': return { type: 'EventEntry', event: 'signed_up', next: '' };
    case 'SegmentEntry': return { type: 'SegmentEntry', audienceId: 0, next: '' };
    case 'Delay': return { type: 'Delay', delay: { kind: 'seconds', seconds: 86400 }, next: '' };
    case 'Message': return { type: 'Message', templateId: 0, next: '' };
    case 'WaitFor': return {
      type: 'WaitFor',
      signal: { kind: 'event', event: 'completed_onboarding' },
      timeoutSeconds: 7 * 86400,
      next: '',
    };
    case 'SegmentSplit': return { type: 'SegmentSplit', audienceId: 0, trueNext: '', falseNext: '' };
    case 'Exit': return { type: 'Exit' };
  }
}
