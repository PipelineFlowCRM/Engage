import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { relativeTime, cn } from '@/lib/utils';

interface EventRow {
  id: string;
  messageId: string | null;
  type: 'track' | 'identify' | 'page' | 'screen' | 'group' | 'alias' | string;
  name: string | null;
  externalId: string | null;
  anonymousId: string | null;
  subscriber: { externalId: string; email: string | null } | null;
  properties: Record<string, unknown>;
  context: Record<string, unknown>;
  observedAt: string;
  receivedAt: string;
  source: string;
}

interface Page {
  events: EventRow[];
  nextCursor: string | null;
}

const TYPES = ['track', 'identify', 'page', 'screen', 'group', 'alias'] as const;

export function Events() {
  const [type, setType] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [extInput, setExtInput] = useState('');
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');

  // Debounce text inputs so each keystroke doesn't refetch.
  useEffect(() => {
    const t = setTimeout(() => setName(nameInput.trim()), 250);
    return () => clearTimeout(t);
  }, [nameInput]);
  useEffect(() => {
    const t = setTimeout(() => setExternalId(extInput.trim()), 250);
    return () => clearTimeout(t);
  }, [extInput]);

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['events', type, name, externalId],
      initialPageParam: '' as string,
      queryFn: ({ pageParam }) => {
        const params = new URLSearchParams();
        if (type) params.set('type', type);
        if (name) params.set('name', name);
        if (externalId) params.set('externalId', externalId);
        if (pageParam) params.set('cursor', pageParam);
        const qs = params.toString();
        return api.get<Page>(`/events${qs ? `?${qs}` : ''}`);
      },
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      // Polling matches the Deliveries page — 5s tail. TanStack Query
      // refetches the first page only; cursor pages stay stable.
      refetchInterval: 5_000,
    });

  const rows = data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <div>
      <PageHeader
        title="Events"
        description="Live tail of incoming events. Defaults to the last 7 days."
      />
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Type</label>
            <select
              className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Event name</label>
            <Input
              className="h-9 w-56"
              placeholder="e.g. clicked_cta"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">External ID</label>
            <Input
              className="h-9 w-56"
              placeholder="e.g. u_42"
              value={extInput}
              onChange={(e) => setExtInput(e.target.value)}
            />
          </div>
          {(type || name || externalId) ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setType('');
                setNameInput('');
                setExtInput('');
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-8 px-3 py-3"></th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Subscriber</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Received</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
                ) : !rows.length ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-muted-foreground">
                      No events in the last 7 days. Send some via{' '}
                      <code className="font-mono">/api/public/track</code> or the JS widget.
                    </td>
                  </tr>
                ) : rows.map((e) => <EventRowItem key={e.id} ev={e} />)}
              </tbody>
            </table>
            {hasNextPage ? (
              <div className="flex justify-center border-t border-border/40 p-3">
                <Button
                  size="sm"
                  variant="outline"
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

function EventRowItem({ ev }: { ev: EventRow }) {
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronDown : ChevronRight;
  const subscriberLabel =
    ev.subscriber?.email ||
    ev.subscriber?.externalId ||
    ev.externalId ||
    (ev.anonymousId ? `anon:${ev.anonymousId.slice(0, 12)}…` : null);

  const detailJson = {
    properties: ev.properties,
    context: ev.context,
    messageId: ev.messageId,
    observedAt: ev.observedAt,
    receivedAt: ev.receivedAt,
    anonymousId: ev.anonymousId,
    externalId: ev.externalId,
  };

  const toggle = () => setOpen((v) => !v);

  return (
    <>
      <tr
        className={cn(
          'cursor-pointer border-b border-border/40 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          open && 'bg-accent/40',
        )}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        <td className="px-3 py-2.5 align-middle">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </td>
        <td className="px-4 py-2.5">
          <Badge variant={typeVariant(ev.type)}>{ev.type}</Badge>
        </td>
        <td className="px-4 py-2.5 font-mono text-xs">
          {ev.name ?? <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5">
          {ev.subscriber ? (
            <Link
              to={`/subscribers/${encodeURIComponent(ev.subscriber.externalId)}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:underline"
            >
              {subscriberLabel}
            </Link>
          ) : subscriberLabel ? (
            <span className="text-muted-foreground">{subscriberLabel}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-2.5">
          <Badge variant="outline">{ev.source}</Badge>
        </td>
        <td className="px-4 py-2.5 text-muted-foreground" title={ev.receivedAt}>
          {relativeTime(ev.receivedAt)}
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-border/40 bg-background/40">
          <td></td>
          <td colSpan={5} className="px-4 pb-4 pt-2">
            <pre className="max-h-96 overflow-auto rounded-md border border-border/60 bg-card/40 p-3 font-mono text-[11.5px] leading-relaxed">
              {JSON.stringify(detailJson, null, 2)}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function typeVariant(t: string) {
  switch (t) {
    case 'track': return 'brand' as const;
    case 'identify': return 'success' as const;
    case 'page':
    case 'screen': return 'warning' as const;
    case 'group': return 'default' as const;
    case 'alias': return 'destructive' as const;
    default: return 'outline' as const;
  }
}
