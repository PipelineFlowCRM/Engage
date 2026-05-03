import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  errorMessage: string | null;
  sendRatePerSecond: number;
  template: { id: number; name: string; subscriptionGroup: { name: string } | null };
  audience: { id: number; name: string };
}

export function BroadcastDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['broadcast', id],
    queryFn: () => api.get<{ broadcast: Broadcast }>(`/broadcasts/${id}`),
    enabled: Boolean(id),
    refetchInterval: 2_000,
  });

  const action = useMutation({
    mutationFn: (a: 'launch' | 'pause' | 'resume' | 'cancel') =>
      api.post(`/broadcasts/${id}/actions`, { action: a }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['broadcast', id] }); qc.invalidateQueries({ queryKey: ['broadcasts'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title="Broadcast" />
        <div className="p-6 text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const b = data.broadcast;
  const canLaunch = b.status === 'draft' || b.status === 'scheduled';
  const canPause = b.status === 'running';
  const canResume = b.status === 'paused';
  const canCancel = !['completed', 'cancelled', 'failed'].includes(b.status);

  return (
    <div>
      <PageHeader
        title={b.name}
        description={
          <>
            <span>{b.audience.name}</span>
            <span className="mx-2">·</span>
            <span>{b.template.name}</span>
            <span className="mx-2">·</span>
            <Badge variant={statusVariant(b.status)}>{b.status}</Badge>
          </>
        }
        actions={
          <>
            {b.status === 'draft' || b.status === 'scheduled' ? (
              <Button asChild variant="outline"><Link to={`/broadcasts/${b.id}/edit`}>Edit</Link></Button>
            ) : null}
            {canLaunch ? <Button variant="brand" onClick={() => action.mutate('launch')} disabled={action.isPending}>Launch now</Button> : null}
            {canPause ? <Button variant="outline" onClick={() => action.mutate('pause')} disabled={action.isPending}>Pause</Button> : null}
            {canResume ? <Button variant="brand" onClick={() => action.mutate('resume')} disabled={action.isPending}>Resume</Button> : null}
            {canCancel ? <Button variant="destructive" onClick={() => action.mutate('cancel')} disabled={action.isPending}>Cancel</Button> : null}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-4">
        <Stat label="Total" value={b.totalRecipients} />
        <Stat label="Sent" value={b.sentCount} />
        <Stat label="Skipped" value={b.skippedCount} />
        <Stat label="Failed" value={b.failedCount} alert={b.failedCount > 0} />
        <Card className="md:col-span-4">
          <CardHeader><CardTitle>Run timeline</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <div>Scheduled for: {b.scheduledFor ? new Date(b.scheduledFor).toLocaleString() : '—'}</div>
            <div>Started: {b.startedAt ? relativeTime(b.startedAt) : '—'}</div>
            <div>Completed: {b.completedAt ? relativeTime(b.completedAt) : '—'}</div>
            <div>Send rate: {b.sendRatePerSecond} / sec</div>
            <div>Subscription group: {b.template.subscriptionGroup?.name ?? '—'}</div>
            {b.errorMessage ? <div className="text-destructive">Error: {b.errorMessage}</div> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <Card className={alert ? 'border-destructive/40' : undefined}>
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums">{formatNumber(value)}</div>
      </CardContent>
    </Card>
  );
}

function statusVariant(s: string) {
  if (s === 'completed') return 'success' as const;
  if (s === 'running' || s === 'snapshotting') return 'brand' as const;
  if (s === 'paused' || s === 'scheduled') return 'warning' as const;
  if (s === 'failed' || s === 'cancelled') return 'destructive' as const;
  return 'outline' as const;
}
