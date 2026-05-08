import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  journeyDefinitionSchema,
  type JourneyDefinition,
} from '@pipelineflow-engagement/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { JourneyGraphView } from '@/components/journey/JourneyGraphView';
import { relativeTime } from '@/lib/utils';

export function JourneyDetail() {
  const { id } = useParams<{ id: string }>();
  const journey = useQuery({
    queryKey: ['journey', id],
    queryFn: () =>
      api.get<{
        journey: {
          id: number; name: string; status: string;
          currentVersion: { version: number; publishedAt: string; definition: unknown } | null;
          versions: Array<{ id: number; version: number; publishedAt: string; definition: unknown }>;
        };
      }>(`/journeys/${id}`),
    enabled: Boolean(id),
  });
  const runs = useQuery({
    queryKey: ['journey', id, 'runs'],
    queryFn: () =>
      api.get<{
        runs: Array<{
          id: string;
          status: string;
          currentNodeId: string;
          startedAt: string;
          completedAt: string | null;
          subscriber: { externalId: string; email: string | null };
          version: { version: number };
        }>;
      }>(`/journeys/${id}/runs?limit=50`),
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });
  // Authoritative per-node counts for the journey map overlay. Polled in
  // step with the runs table so the pills and rows stay in sync.
  const runCountsQuery = useQuery({
    queryKey: ['journey', id, 'run-counts'],
    queryFn: () =>
      api.get<{ counts: Record<string, number> }>(`/journeys/${id}/run-counts`),
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });

  // Parse the published definition outside the early-return so hooks
  // ordering stays stable. Distinguish three states so we can show a
  // "stored definition is broken" message separately from the unpublished
  // empty state.
  type DefState =
    | { kind: 'none' }
    | { kind: 'invalid' }
    | { kind: 'ok'; def: JourneyDefinition };
  const defState = useMemo<DefState>(() => {
    const raw = journey.data?.journey.currentVersion?.definition;
    if (raw === undefined || raw === null) return { kind: 'none' };
    const parsed = journeyDefinitionSchema.safeParse(raw);
    return parsed.success ? { kind: 'ok', def: parsed.data } : { kind: 'invalid' };
  }, [journey.data]);

  const runCounts = runCountsQuery.data?.counts;

  if (!journey.data) {
    return (
      <div>
        <PageHeader title="Journey" />
        <div className="p-6 text-muted-foreground">Loading…</div>
      </div>
    );
  }
  const j = journey.data.journey;

  return (
    <div>
      <PageHeader
        title={j.name}
        description={
          <>
            <Badge variant="outline">v{j.currentVersion?.version ?? '—'}</Badge>
            <span className="mx-2">·</span>
            <Badge variant="outline">{j.status}</Badge>
          </>
        }
        actions={<Button asChild variant="outline"><Link to={`/journeys/${j.id}/edit`}>Edit</Link></Button>}
      />
      <div className="px-6 pt-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle>Journey map</CardTitle>
            <span className="text-xs text-muted-foreground">
              {defState.kind === 'ok'
                ? `${Object.keys(defState.def.nodes).length} nodes · v${j.currentVersion?.version ?? '—'}`
                : defState.kind === 'invalid'
                  ? 'Definition error'
                  : 'No published version'}
            </span>
          </CardHeader>
          <CardContent className="p-0">
            {defState.kind === 'ok' ? (
              <JourneyGraphView
                definition={defState.def}
                runCounts={runCounts}
                className="h-[420px] rounded-b-md overflow-hidden"
              />
            ) : defState.kind === 'invalid' ? (
              <div className="flex h-[420px] items-center justify-center px-6 text-center text-sm text-destructive">
                Stored definition for v{j.currentVersion?.version} could not be parsed.
                Open the editor to repair it.
              </div>
            ) : (
              <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
                Publish a version to see the journey map.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Recent runs</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Subscriber</th>
                  <th className="px-4 py-3">v</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Current node</th>
                  <th className="px-4 py-3">Started / done</th>
                </tr>
              </thead>
              <tbody>
                {runs.isLoading ? <tr><td colSpan={5} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
                : !runs.data?.runs.length ? <tr><td colSpan={5} className="px-4 py-6 text-muted-foreground">No runs yet — fire an entry event for a subscriber to start one.</td></tr>
                : runs.data.runs.map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="px-4 py-2.5">
                      <Link to={`/subscribers/${encodeURIComponent(r.subscriber.externalId)}`} className="font-mono text-xs hover:underline">
                        {r.subscriber.email ?? r.subscriber.externalId}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">v{r.version.version}</td>
                    <td className="px-4 py-2.5"><Badge variant={runStatusVariant(r.status)}>{r.status}</Badge></td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.currentNodeId}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {r.completedAt ? `done ${relativeTime(r.completedAt)}` : `started ${relativeTime(r.startedAt)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Versions</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {j.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between rounded border border-border/60 px-3 py-2">
                  <div>
                    <div className="font-medium">v{v.version}</div>
                    <div className="text-xs text-muted-foreground">{relativeTime(v.publishedAt)}</div>
                  </div>
                  {j.currentVersion?.version === v.version ? <Badge variant="success">current</Badge> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function runStatusVariant(s: string) {
  if (s === 'completed') return 'success' as const;
  if (s === 'running') return 'brand' as const;
  if (s === 'waiting') return 'warning' as const;
  if (s === 'failed' || s === 'cancelled') return 'destructive' as const;
  return 'outline' as const;
}
