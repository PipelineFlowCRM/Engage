import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber, relativeTime } from '@/lib/utils';

interface Audience {
  id: number;
  name: string;
  status: 'active' | 'paused' | 'archived';
  memberCount: number;
  computeIntervalSeconds: number;
  lastComputedAt: string | null;
  lastComputeError: string | null;
  lastComputeWarning: string | null;
}

export function Audiences() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['audiences'],
    queryFn: () => api.get<{ audiences: Audience[] }>('/audiences'),
  });

  const recompute = useMutation({
    mutationFn: (id: number) => api.post(`/audiences/${id}/recompute`),
    onSuccess: () => { toast.success('Recompute enqueued'); qc.invalidateQueries({ queryKey: ['audiences'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <PageHeader
        title="Audiences"
        description="Segments compiled from traits + events. Materialised on a periodic schedule."
        actions={<Button asChild variant="brand"><Link to="/audiences/new">New audience</Link></Button>}
      />
      <div className="space-y-4 p-6">
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Members</th>
                  <th className="px-4 py-3">Interval</th>
                  <th className="px-4 py-3">Last compute</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
                ) : !data?.audiences.length ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-muted-foreground">No audiences yet. <Link to="/audiences/new" className="underline">Create one</Link>.</td></tr>
                ) : data.audiences.map((a) => (
                  <tr key={a.id} className="border-b border-border/40 hover:bg-accent/40">
                    <td className="px-4 py-2.5 font-medium">
                      <Link to={`/audiences/${a.id}`} className="hover:underline">{a.name}</Link>
                      {a.lastComputeError ? (
                        <div className="mt-1 text-xs text-destructive truncate max-w-md">{a.lastComputeError}</div>
                      ) : null}
                      {a.lastComputeWarning ? (
                        <div className="mt-1 text-xs text-warning truncate max-w-md" title={a.lastComputeWarning}>
                          ⚠ {a.lastComputeWarning}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{formatNumber(a.memberCount)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{Math.round(a.computeIntervalSeconds / 60)}m</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{relativeTime(a.lastComputedAt)}</td>
                    <td className="px-4 py-2.5"><Badge variant={a.status === 'active' ? 'success' : 'outline'}>{a.status}</Badge></td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="outline" onClick={() => recompute.mutate(a.id)} disabled={recompute.isPending}>Recompute</Button>
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
