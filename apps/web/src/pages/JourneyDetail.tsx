import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/utils';

export function JourneyDetail() {
  const { id } = useParams<{ id: string }>();
  const journey = useQuery({
    queryKey: ['journey', id],
    queryFn: () =>
      api.get<{
        journey: {
          id: number; name: string; status: string;
          currentVersion: { version: number; publishedAt: string } | null;
          versions: Array<{ id: number; version: number; publishedAt: string }>;
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
