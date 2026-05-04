import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber, relativeTime } from '@/lib/utils';

interface Summary {
  subscribers: number;
  activeAudiences: number;
  publishedTemplates: number;
  activeBroadcasts: number;
  deliveriesLast24h: number;
  bouncesLast24h: number;
  complaintsLast24h: number;
  suppressions: number;
}

interface Deliverability {
  snapshot: {
    asOf: string;
    totalSent: number;
    totalBounced: number;
    totalComplained: number;
    bounceRate: number;
    complaintRate: number;
  } | null;
  alerts: Array<{
    id: string;
    kind: string;
    severity: 'critical' | 'warning';
    meta: Record<string, unknown>;
    triggeredAt: string;
  }>;
}

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Summary>('/dashboard/summary'),
  });
  const deliverability = useQuery({
    queryKey: ['deliverability'],
    queryFn: () => api.get<Deliverability>('/admin/deliverability'),
    refetchInterval: 60_000,
  });

  return (
    <div>
      <PageHeader title="Dashboard" description="At-a-glance health of subscribers, audiences, and recent sends." />

      {deliverability.data?.alerts.length ? (
        <div className="px-6 pt-4 space-y-2">
          {deliverability.data.alerts.map((a) => (
            <div
              key={a.id}
              className={`rounded-md border p-3 text-sm ${
                a.severity === 'critical' ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'border-warning/40 bg-warning/5'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Badge variant={a.severity === 'critical' ? 'destructive' : 'warning'} className="mr-2">{a.severity}</Badge>
                  <span className="font-medium">{labelForKind(a.kind)}</span>
                  {' — '}
                  {formatRate(Number((a.meta as { rate?: number }).rate ?? 0))} (threshold {formatRate(Number((a.meta as { threshold?: number }).threshold ?? 0))})
                </div>
                <div className="text-xs opacity-80">triggered {relativeTime(a.triggeredAt)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
        <Tile title="Subscribers" value={data?.subscribers} loading={isLoading} />
        <Tile title="Active audiences" value={data?.activeAudiences} loading={isLoading} />
        <Tile title="Published templates" value={data?.publishedTemplates} loading={isLoading} />
        <Tile title="Active broadcasts" value={data?.activeBroadcasts} loading={isLoading} />
        <Tile title="Deliveries (24h)" value={data?.deliveriesLast24h} loading={isLoading} />
        <Tile
          title="Bounces (24h)"
          value={data?.bouncesLast24h}
          loading={isLoading}
          alert={Boolean(data && data.deliveriesLast24h > 0 && data.bouncesLast24h / data.deliveriesLast24h > 0.05)}
        />
        <Tile
          title="Complaints (24h)"
          value={data?.complaintsLast24h}
          loading={isLoading}
          alert={Boolean(data && data.deliveriesLast24h > 0 && data.complaintsLast24h / data.deliveriesLast24h > 0.001)}
        />
        <Tile title="Suppression list" value={data?.suppressions} loading={isLoading} />
      </div>

      {deliverability.data?.snapshot ? (
        <div className="px-6 pb-6">
          <Card>
            <CardContent className="p-5">
              <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                Deliverability — last 24h
              </div>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                <Rate label="Sent" raw={data ? formatNumber(deliverability.data.snapshot.totalSent) : '…'} />
                <Rate label="Bounce rate" raw={formatRate(deliverability.data.snapshot.bounceRate)} alert={deliverability.data.snapshot.bounceRate > 0.05} />
                <Rate label="Complaint rate" raw={formatRate(deliverability.data.snapshot.complaintRate)} alert={deliverability.data.snapshot.complaintRate > 0.001} />
                <Rate label="As of" raw={relativeTime(deliverability.data.snapshot.asOf)} />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Rate({ label, raw, alert }: { label: string; raw: string; alert?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl tabular-nums ${alert ? 'text-destructive' : ''}`}>{raw}</div>
    </div>
  );
}

function labelForKind(kind: string): string {
  switch (kind) {
    case 'complaint_rate': return 'Complaint rate above threshold';
    case 'bounce_rate': return 'Bounce rate above threshold';
    case 'ses_paused': return 'SES sending paused';
    case 'ses_quota_low': return 'SES quota nearly exhausted';
    default: return kind;
  }
}

function formatRate(r: number): string {
  return `${(r * 100).toFixed(2)}%`;
}

function Tile({
  title, value, loading, alert,
}: { title: string; value: number | undefined; loading: boolean; alert?: boolean }) {
  return (
    <Card className={alert ? 'border-destructive/40' : undefined}>
      <CardContent className="p-5">
        <CardDescription className="text-xs uppercase tracking-wider">{title}</CardDescription>
        <CardTitle className="mt-1 text-3xl tabular-nums">
          {loading ? '…' : formatNumber(value ?? 0)}
        </CardTitle>
        {alert ? (
          <div className="mt-2 text-xs font-medium text-destructive">Above threshold — investigate</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
