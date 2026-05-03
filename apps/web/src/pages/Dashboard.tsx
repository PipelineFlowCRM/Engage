import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';

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

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Summary>('/dashboard/summary'),
  });

  return (
    <div>
      <PageHeader title="Dashboard" description="At-a-glance health of subscribers, audiences, and recent sends." />
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
    </div>
  );
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
