import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber, relativeTime } from '@/lib/utils';

interface Journey {
  id: number;
  name: string;
  status: 'draft' | 'published' | 'paused' | 'archived';
  description: string | null;
  currentVersion: { id: number; version: number; publishedAt: string } | null;
  runCounts: Partial<Record<'running' | 'waiting' | 'completed' | 'cancelled' | 'failed', number>>;
  updatedAt: string;
}

export function Journeys() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['journeys'],
    queryFn: () => api.get<{ journeys: Journey[] }>('/journeys'),
    refetchInterval: 5_000,
  });

  const action = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'pause' | 'resume' | 'archive' }) =>
      api.post(`/journeys/${id}/actions`, { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journeys'] }),
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <PageHeader
        title="Journeys"
        description="Per-subscriber state machines. Trigger from audience entry or events; advance via delays, messages, waits, splits."
        actions={<Button asChild variant="brand"><Link to="/journeys/new">New journey</Link></Button>}
      />
      <div className="p-6">
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Runs (running / waiting / done)</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
                ) : !data?.journeys.length ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-muted-foreground">No journeys. <Link to="/journeys/new" className="underline">Create one</Link>.</td></tr>
                ) : data.journeys.map((j) => (
                  <tr key={j.id} className="border-b border-border/40 hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      <Link to={`/journeys/${j.id}`} className="font-medium hover:underline">{j.name}</Link>
                      {j.description ? <div className="text-xs text-muted-foreground">{j.description}</div> : null}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {j.currentVersion ? `v${j.currentVersion.version}` : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={statusVariant(j.status)}>{j.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-xs">
                      {formatNumber(j.runCounts.running ?? 0)} / {formatNumber(j.runCounts.waiting ?? 0)} / {formatNumber(j.runCounts.completed ?? 0)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{relativeTime(j.updatedAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {j.status === 'published' ? (
                        <Button size="sm" variant="outline" onClick={() => action.mutate({ id: j.id, action: 'pause' })}>Pause</Button>
                      ) : j.status === 'paused' ? (
                        <Button size="sm" variant="brand" onClick={() => action.mutate({ id: j.id, action: 'resume' })}>Resume</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function statusVariant(s: string) {
  if (s === 'published') return 'success' as const;
  if (s === 'paused') return 'warning' as const;
  if (s === 'archived') return 'destructive' as const;
  return 'outline' as const;
}
