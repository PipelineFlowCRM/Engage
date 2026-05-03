import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber, relativeTime } from '@/lib/utils';

interface Broadcast {
  id: number;
  name: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  template: { id: number; name: string };
  audience: { id: number; name: string };
}

export function Broadcasts() {
  const { data, isLoading } = useQuery({
    queryKey: ['broadcasts'],
    queryFn: () => api.get<{ broadcasts: Broadcast[] }>('/broadcasts'),
    refetchInterval: 5_000,
  });

  return (
    <div>
      <PageHeader
        title="Broadcasts"
        description="One-shot sends to an audience snapshot. Pause/resume/cancel from the detail view."
        actions={<Button asChild variant="brand"><Link to="/broadcasts/new">New broadcast</Link></Button>}
      />
      <div className="p-6">
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Audience / Template</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Sent / Total</th>
                  <th className="px-4 py-3">Scheduled / started</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? <tr><td colSpan={5} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
                : !data?.broadcasts.length ? <tr><td colSpan={5} className="px-4 py-6 text-muted-foreground">No broadcasts yet.</td></tr>
                : data.broadcasts.map((b) => (
                  <tr key={b.id} className="border-b border-border/40 hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      <Link to={`/broadcasts/${b.id}`} className="font-medium hover:underline">{b.name}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      <div>{b.audience.name}</div>
                      <div>{b.template.name}</div>
                    </td>
                    <td className="px-4 py-2.5"><Badge variant={statusVariant(b.status)}>{b.status}</Badge></td>
                    <td className="px-4 py-2.5 tabular-nums">{formatNumber(b.sentCount)} / {formatNumber(b.totalRecipients)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {b.completedAt ? `done ${relativeTime(b.completedAt)}`
                       : b.startedAt ? `started ${relativeTime(b.startedAt)}`
                       : b.scheduledFor ? `for ${new Date(b.scheduledFor).toLocaleString()}`
                       : '—'}
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
  if (s === 'completed') return 'success' as const;
  if (s === 'running' || s === 'snapshotting') return 'brand' as const;
  if (s === 'paused' || s === 'scheduled') return 'warning' as const;
  if (s === 'failed' || s === 'cancelled') return 'destructive' as const;
  return 'outline' as const;
}
