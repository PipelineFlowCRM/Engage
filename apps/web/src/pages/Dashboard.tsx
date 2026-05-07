import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Filter, Inbox, Mail, Send, ShieldOff, TrendingDown, Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn, formatNumber, relativeTime } from '@/lib/utils';

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

type Accent = 'brand' | 'email' | 'trigger' | 'warning' | 'destructive' | 'neutral';

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

  const bounceAlert = Boolean(
    data && data.deliveriesLast24h > 0 && data.bouncesLast24h / data.deliveriesLast24h > 0.05,
  );
  const complaintAlert = Boolean(
    data && data.deliveriesLast24h > 0 && data.complaintsLast24h / data.deliveriesLast24h > 0.001,
  );

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="At-a-glance health of subscribers, audiences, and recent sends."
      />

      {deliverability.data?.alerts.length ? (
        <div className="space-y-2 px-6 pt-4">
          {deliverability.data.alerts.map((a) => (
            <div
              key={a.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm',
                a.severity === 'critical'
                  ? 'border-destructive/40 bg-destructive/5 text-destructive'
                  : 'border-warning/40 bg-warning/5',
              )}
            >
              <div>
                <Badge
                  variant={a.severity === 'critical' ? 'destructive' : 'warning'}
                  className="mr-2"
                >
                  {a.severity}
                </Badge>
                <span className="font-medium">{labelForKind(a.kind)}</span>
                {' — '}
                {formatRate(Number((a.meta as { rate?: number }).rate ?? 0))} (threshold{' '}
                {formatRate(Number((a.meta as { threshold?: number }).threshold ?? 0))})
              </div>
              <div className="text-xs opacity-80">triggered {relativeTime(a.triggeredAt)}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
        <Tile title="Subscribers"        icon={Users}    accent="brand"   value={data?.subscribers}         loading={isLoading} />
        <Tile title="Active audiences"   icon={Filter}   accent="brand"   value={data?.activeAudiences}     loading={isLoading} />
        <Tile title="Published templates" icon={Mail}    accent="email"   value={data?.publishedTemplates}  loading={isLoading} />
        <Tile title="Active broadcasts"  icon={Send}     accent="email"   value={data?.activeBroadcasts}    loading={isLoading} />
        <Tile title="Deliveries (24h)"   icon={Inbox}    accent="trigger" value={data?.deliveriesLast24h}   loading={isLoading} />
        <Tile
          title="Bounces (24h)"
          icon={TrendingDown}
          accent={bounceAlert ? 'destructive' : 'warning'}
          value={data?.bouncesLast24h}
          loading={isLoading}
          alert={bounceAlert}
          alertText="Above 5% — investigate sender reputation"
        />
        <Tile
          title="Complaints (24h)"
          icon={AlertTriangle}
          accent={complaintAlert ? 'destructive' : 'neutral'}
          value={data?.complaintsLast24h}
          loading={isLoading}
          alert={complaintAlert}
          alertText="Above 0.1% — investigate immediately"
        />
        <Tile title="Suppression list" icon={ShieldOff} accent="neutral" value={data?.suppressions} loading={isLoading} />
      </div>

      {deliverability.data?.snapshot ? (
        <div className="px-6 pb-8">
          <Card className="surface-elevated overflow-hidden">
            <CardContent className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Deliverability — last 24h
                </div>
                <div className="text-[11px] text-muted-foreground">
                  As of {relativeTime(deliverability.data.snapshot.asOf)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                <Rate
                  label="Sent"
                  raw={formatNumber(deliverability.data.snapshot.totalSent)}
                  accent="brand"
                />
                <Rate
                  label="Bounced"
                  raw={formatNumber(deliverability.data.snapshot.totalBounced)}
                  accent="warning"
                />
                <Rate
                  label="Bounce rate"
                  raw={formatRate(deliverability.data.snapshot.bounceRate)}
                  alert={deliverability.data.snapshot.bounceRate > 0.05}
                />
                <Rate
                  label="Complaint rate"
                  raw={formatRate(deliverability.data.snapshot.complaintRate)}
                  alert={deliverability.data.snapshot.complaintRate > 0.001}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Rate({
  label, raw, alert, accent,
}: {
  label: string;
  raw: string;
  alert?: boolean;
  accent?: 'brand' | 'warning';
}) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-1.5 text-2xl font-semibold tabular',
          alert
            ? 'text-destructive'
            : accent === 'brand'
              ? 'text-gradient'
              : accent === 'warning'
                ? 'text-warning'
                : '',
        )}
      >
        {raw}
      </div>
    </div>
  );
}

function labelForKind(kind: string): string {
  switch (kind) {
    case 'complaint_rate': return 'Complaint rate above threshold';
    case 'bounce_rate':    return 'Bounce rate above threshold';
    case 'ses_paused':     return 'SES sending paused';
    case 'ses_quota_low':  return 'SES quota nearly exhausted';
    default: return kind;
  }
}

function formatRate(r: number): string {
  return `${(r * 100).toFixed(2)}%`;
}

const ACCENTS: Record<Accent, { icon: string; ring: string }> = {
  brand:      { icon: 'bg-gradient-brand text-white',                    ring: '' },
  email:      { icon: 'bg-channel-email-tint text-channel-email',         ring: '' },
  trigger:    { icon: 'bg-channel-trigger-tint text-channel-trigger',     ring: '' },
  warning:    { icon: 'bg-warning/15 text-warning',                       ring: '' },
  destructive:{ icon: 'bg-destructive/15 text-destructive',               ring: 'border-destructive/40' },
  neutral:    { icon: 'bg-muted text-muted-foreground',                   ring: '' },
};

function Tile({
  title, value, loading, alert, alertText, icon: Icon, accent = 'neutral',
}: {
  title: string;
  value: number | undefined;
  loading: boolean;
  alert?: boolean;
  alertText?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: Accent;
}) {
  const a = ACCENTS[accent];
  return (
    <Card className={cn('relative overflow-hidden', a.ring)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {title}
          </div>
          <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md', a.icon)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 text-3xl font-semibold tabular">
          {loading ? '…' : formatNumber(value ?? 0)}
        </div>
        {alert ? (
          <div className="mt-2 text-xs font-medium text-destructive">
            {alertText ?? 'Above threshold — investigate'}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
