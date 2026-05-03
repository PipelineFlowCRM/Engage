import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/utils';

export function SubscriberDetail() {
  const { externalId } = useParams<{ externalId: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ['subscriber', externalId],
    queryFn: () =>
      api.get<{
        subscriber: {
          id: string;
          externalId: string;
          email: string | null;
          phone: string | null;
          source: string;
          traits: Record<string, unknown>;
          createdAt: string;
          updatedAt: string;
          subscriptions: Array<{ groupId: number; status: string; group: { name: string } }>;
          deliveries: Array<{ id: string; subject: string | null; status: string; createdAt: string }>;
        };
      }>(`/subscribers/${encodeURIComponent(externalId ?? '')}`),
    enabled: Boolean(externalId),
  });

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Subscriber" />
        <div className="p-6 text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!data) return <div className="p-6">Not found</div>;
  const s = data.subscriber;

  return (
    <div>
      <PageHeader title={s.email ?? s.externalId} description={`External ID: ${s.externalId}`} />
      <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row k="Email" v={s.email ?? '—'} />
            <Row k="Phone" v={s.phone ?? '—'} />
            <Row k="Source" v={<Badge variant="outline">{s.source}</Badge>} />
            <Row k="Created" v={relativeTime(s.createdAt)} />
            <Row k="Updated" v={relativeTime(s.updatedAt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Traits</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs font-mono">
              {JSON.stringify(s.traits, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Subscriptions</CardTitle>
          </CardHeader>
          <CardContent>
            {!s.subscriptions.length ? (
              <p className="text-sm text-muted-foreground">No subscription state recorded — defaults to opt_out group rules.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-2">Group</th><th>Status</th></tr></thead>
                <tbody>
                  {s.subscriptions.map((ss) => (
                    <tr key={ss.groupId} className="border-t border-border/40">
                      <td className="py-2">{ss.group.name}</td>
                      <td>{ss.status === 'subscribed' ? <Badge variant="success">subscribed</Badge> : <Badge variant="warning">unsubscribed</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent deliveries</CardTitle>
          </CardHeader>
          <CardContent>
            {!s.deliveries.length ? (
              <p className="text-sm text-muted-foreground">No deliveries yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Subject</th><th>Status</th><th>When</th></tr>
                </thead>
                <tbody>
                  {s.deliveries.map((d) => (
                    <tr key={d.id} className="border-t border-border/40">
                      <td className="py-2">{d.subject ?? '—'}</td>
                      <td><Badge variant="outline">{d.status}</Badge></td>
                      <td className="text-muted-foreground">{relativeTime(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
