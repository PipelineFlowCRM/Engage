import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/utils';

interface Delivery {
  id: string;
  status: string;
  toEmail: string;
  subject: string | null;
  createdAt: string;
  sentAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  bouncedAt: string | null;
  template: { name: string } | null;
  subscriber: { externalId: string; email: string | null };
}

interface Page {
  deliveries: Delivery[];
  nextCursor: string | null;
}

const STATUSES = ['queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed', 'failed', 'suppressed'] as const;

export function Deliveries() {
  const [status, setStatus] = useState('');
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['deliveries', status],
      initialPageParam: '' as string,
      queryFn: ({ pageParam }) => {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (pageParam) params.set('cursor', pageParam);
        const qs = params.toString();
        return api.get<Page>(`/deliveries${qs ? `?${qs}` : ''}`);
      },
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      // Refetch only the first page on the polling interval — preserves
      // pagination state and avoids ballooning the cache.
      refetchInterval: 5_000,
    });

  const rows = data?.pages.flatMap((p) => p.deliveries) ?? [];

  return (
    <div>
      <PageHeader title="Deliveries" description="Per-message lifecycle. Updates from SES SNS notifications." />
      <div className="space-y-4 p-6">
        <select
          className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">When</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? <tr><td colSpan={5} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
                : !rows.length ? <tr><td colSpan={5} className="px-4 py-6 text-muted-foreground">No deliveries.</td></tr>
                : rows.map((d) => (
                  <tr key={d.id} className="border-b border-border/40 hover:bg-accent/40">
                    <td className="px-4 py-2.5">{d.toEmail}</td>
                    <td className="px-4 py-2.5">{d.subject ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-2.5">{d.template?.name ?? '—'}</td>
                    <td className="px-4 py-2.5"><Badge variant={statusVariant(d.status)}>{d.status}</Badge></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{relativeTime(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasNextPage ? (
              <div className="flex justify-center border-t border-border/40 p-3">
                <Button
                  size="sm" variant="outline"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function statusVariant(s: string) {
  if (s === 'sent' || s === 'delivered' || s === 'opened' || s === 'clicked') return 'success' as const;
  if (s === 'queued') return 'warning' as const;
  if (s === 'bounced' || s === 'complained' || s === 'failed' || s === 'suppressed') return 'destructive' as const;
  return 'outline' as const;
}
