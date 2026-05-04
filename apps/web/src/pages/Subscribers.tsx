import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/utils';

interface Subscriber {
  id: string;
  externalId: string;
  email: string | null;
  source: string;
  updatedAt: string;
}

interface Page {
  subscribers: Subscriber[];
  nextCursor: string | null;
}

export function Subscribers() {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  // Debounce the search term so each keystroke doesn't trigger a query.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['subscribers', q],
      initialPageParam: '' as string,
      queryFn: ({ pageParam }) => {
        const params = new URLSearchParams({ q });
        if (pageParam) params.set('cursor', pageParam);
        return api.get<Page>(`/subscribers?${params.toString()}`);
      },
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    });

  const rows = data?.pages.flatMap((p) => p.subscribers) ?? [];

  return (
    <div>
      <PageHeader
        title="Subscribers"
        description="End-users you can target with audiences, broadcasts, and journeys."
      />
      <div className="space-y-4 p-6">
        <Input
          placeholder="Search by email or external id…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="max-w-md"
        />
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">External ID</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
                ) : !rows.length ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-muted-foreground">No subscribers yet. Send events to <code className="font-mono">/api/public/identify</code> to populate.</td></tr>
                ) : rows.map((s) => (
                  <tr key={s.id} className="border-b border-border/40 hover:bg-accent/40">
                    <td className="px-4 py-2.5 font-mono text-xs">
                      <Link to={`/subscribers/${encodeURIComponent(s.externalId)}`} className="hover:underline">
                        {s.externalId}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">{s.email ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-2.5"><Badge variant="outline">{s.source}</Badge></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{relativeTime(s.updatedAt)}</td>
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
