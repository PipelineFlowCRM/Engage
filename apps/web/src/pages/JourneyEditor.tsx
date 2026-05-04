import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  journeyDefinitionSchema,
  type JourneyDefinition,
  type JourneyNode,
} from '@pipelineflow-engagement/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

const SAMPLE_DEFINITION = JSON.stringify(
  {
    entry: 'entry',
    nodes: {
      entry: {
        type: 'EventEntry',
        event: 'signed_up',
        next: 'wait1',
      },
      wait1: {
        type: 'Delay',
        delay: { kind: 'seconds', seconds: 86400 },
        next: 'welcome',
      },
      welcome: {
        type: 'Message',
        templateId: 1,
        next: 'waitForActivate',
      },
      waitForActivate: {
        type: 'WaitFor',
        signal: { kind: 'event', event: 'completed_onboarding' },
        timeoutSeconds: 7 * 86400,
        next: 'exitDone',
        timeoutNext: 'nudge',
      },
      nudge: { type: 'Message', templateId: 2, next: 'exitTimeout' },
      exitDone: { type: 'Exit', reason: 'activated' },
      exitTimeout: { type: 'Exit', reason: 'timeout-after-nudge' },
    },
  },
  null, 2,
);

export function JourneyEditor() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = idParam ? Number(idParam) : null;
  const isNew = id == null;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defText, setDefText] = useState(SAMPLE_DEFINITION);
  const [defError, setDefError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<JourneyDefinition | null>(null);

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

  useEffect(() => {
    if (existing.data?.journey) {
      setName(existing.data.journey.name);
      setDescription(existing.data.journey.description ?? '');
      // Prefer the latest version (which is the working draft after a save)
      // over currentVersion, so editing-after-save doesn't overwrite drafts.
      const latest = existing.data.journey.versions[0];
      const def = latest?.definition ?? existing.data.journey.currentVersion?.definition;
      if (def) setDefText(JSON.stringify(def, null, 2));
    }
  }, [existing.data]);

  // Re-parse on every keystroke so the preview pane reflects current state.
  useEffect(() => {
    setDefError(null);
    setParsed(null);
    let raw: unknown;
    try {
      raw = JSON.parse(defText);
    } catch (err) {
      setDefError(`JSON: ${err instanceof Error ? err.message : err}`);
      return;
    }
    const v = journeyDefinitionSchema.safeParse(raw);
    if (!v.success) {
      const issues = v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
      setDefError(issues);
      return;
    }
    setParsed(v.data);
  }, [defText]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        description: description || null,
        ...(parsed ? { definition: parsed } : {}),
      };
      return isNew ? api.post('/journeys', body) : api.patch(`/journeys/${id}`, body);
    },
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['journeys'] }); navigate('/journeys'); },
    onError: (err: Error) => toast.error(err.message),
  });

  const publish = useMutation({
    mutationFn: () => api.post(`/journeys/${id}/publish`, { definition: parsed }),
    onSuccess: () => { toast.success('Published'); qc.invalidateQueries({ queryKey: ['journeys'] }); navigate('/journeys'); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <PageHeader
        title={isNew ? 'New journey' : 'Edit journey'}
        description="Define the journey graph as a JSON tree. Visual builder coming in a polish pass."
        actions={
          <>
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save draft'}
            </Button>
            {!isNew ? (
              <Button variant="brand" disabled={publish.isPending || !parsed} onClick={() => publish.mutate()}>
                {publish.isPending ? 'Publishing…' : 'Publish'}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2"><Label>Name</Label><Input required value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-2"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Definition (JSON)</CardTitle>
            <p className="text-xs text-muted-foreground">
              Top level: <code className="font-mono">{`{ entry, nodes }`}</code>. Node types:
              <Badge variant="outline" className="ml-1 text-[10px]">EventEntry</Badge>
              <Badge variant="outline" className="ml-1 text-[10px]">SegmentEntry</Badge>
              <Badge variant="outline" className="ml-1 text-[10px]">Delay</Badge>
              <Badge variant="outline" className="ml-1 text-[10px]">Message</Badge>
              <Badge variant="outline" className="ml-1 text-[10px]">WaitFor</Badge>
              <Badge variant="outline" className="ml-1 text-[10px]">SegmentSplit</Badge>
              <Badge variant="outline" className="ml-1 text-[10px]">Exit</Badge>
            </p>
          </CardHeader>
          <CardContent>
            <Textarea rows={26} className="font-mono text-[11px]" value={defText} onChange={(e) => setDefText(e.target.value)} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Preview</CardTitle></CardHeader>
          <CardContent>
            {defError ? (
              <pre className="rounded bg-destructive/10 p-3 text-xs text-destructive whitespace-pre-wrap">{defError}</pre>
            ) : !parsed ? (
              <p className="text-sm text-muted-foreground">Parsing…</p>
            ) : (
              <DefinitionPreview definition={parsed} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Linear walk of the graph from `entry`. Where multiple branches exist
// (SegmentSplit, WaitFor.timeoutNext) we render both. Cycles are unlikely
// (the runner guards against them via TICK_NODE_BUDGET) but we cap the walk
// at 50 to be safe.
function DefinitionPreview({ definition }: { definition: JourneyDefinition }) {
  const lines: { depth: number; nodeId: string; label: string; sub?: string }[] = [];
  const visited = new Set<string>();
  walk(definition, definition.entry, 0, lines, visited);
  return (
    <div className="space-y-1.5 font-mono text-xs">
      {lines.map((l, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="text-muted-foreground" style={{ paddingLeft: `${l.depth * 16}px` }}>
            {l.depth > 0 ? '└─' : '●'}
          </span>
          <div>
            <div>
              <span className="text-foreground">{l.label}</span>
              <span className="ml-2 text-muted-foreground">{l.nodeId}</span>
            </div>
            {l.sub ? <div className="text-muted-foreground">{l.sub}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function walk(
  def: JourneyDefinition,
  nodeId: string,
  depth: number,
  out: { depth: number; nodeId: string; label: string; sub?: string }[],
  visited: Set<string>,
): void {
  if (depth > 50 || visited.has(nodeId)) return;
  visited.add(nodeId);
  const n = def.nodes[nodeId];
  if (!n) {
    out.push({ depth, nodeId, label: '⚠ missing node', sub: nodeId });
    return;
  }
  out.push({ depth, nodeId, label: n.type, sub: describeNode(n) });
  switch (n.type) {
    case 'EventEntry':
    case 'SegmentEntry':
    case 'Delay':
    case 'Message':
      walk(def, n.next, depth + 1, out, visited);
      break;
    case 'SegmentSplit':
      out.push({ depth: depth + 1, nodeId: '', label: 'true →', sub: '' });
      walk(def, n.trueNext, depth + 2, out, visited);
      out.push({ depth: depth + 1, nodeId: '', label: 'false →', sub: '' });
      walk(def, n.falseNext, depth + 2, out, visited);
      break;
    case 'WaitFor':
      walk(def, n.next, depth + 1, out, visited);
      if (n.timeoutNext) {
        out.push({ depth: depth + 1, nodeId: '', label: 'timeout →', sub: '' });
        walk(def, n.timeoutNext, depth + 2, out, visited);
      }
      break;
    case 'Exit':
      break;
  }
}

function describeNode(n: JourneyNode): string {
  switch (n.type) {
    case 'EventEntry': return `event: ${n.event}`;
    case 'SegmentEntry': return `audience: ${n.audienceId}`;
    case 'Delay':
      return n.delay.kind === 'seconds'
        ? `${n.delay.seconds}s`
        : `at ${String(n.delay.hour).padStart(2, '0')}:${String(n.delay.minute).padStart(2, '0')} local`;
    case 'Message': return `template: ${n.templateId}`;
    case 'WaitFor':
      return `${n.signal.kind === 'event' ? `event=${n.signal.event}` : `audience=${n.signal.audienceId}`} (timeout ${n.timeoutSeconds}s)`;
    case 'SegmentSplit': return `audience: ${n.audienceId}`;
    case 'Exit': return n.reason ?? '(no reason)';
  }
}
