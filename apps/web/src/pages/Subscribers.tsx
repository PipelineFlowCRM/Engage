import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
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

export function Subscribers() {
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['subscribers', q],
    queryFn: () =>
      api.get<{ subscribers: Subscriber[]; nextCursor: string | null }>(
        `/subscribers?${new URLSearchParams({ q }).toString()}`,
      ),
  });

  return (
    <div>
      <PageHeader
        title="Subscribers"
        description="End-users you can target with audiences, broadcasts, and (Phase 2) journeys."
      />
      <div className="space-y-4 p-6">
        <Input
          placeholder="Search by email or external id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
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
                ) : !data?.subscribers.length ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-muted-foreground">No subscribers yet. Send events to <code className="font-mono">/api/public/identify</code> to populate.</td></tr>
                ) : data.subscribers.map((s) => (
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
