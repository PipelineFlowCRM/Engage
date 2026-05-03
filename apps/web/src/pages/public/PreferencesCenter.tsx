import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';

interface PrefsResponse {
  subscriber: { externalId: string; email: string | null };
  groups: Array<{ id: number; name: string; description: string | null; type: 'opt_in' | 'opt_out'; status: 'subscribed' | 'unsubscribed' }>;
}

export function PreferencesCenter() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PrefsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    if (!token) return;
    try {
      const res = await fetch(`/p/preferences/${encodeURIComponent(token)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load preferences');
    }
  }

  async function save(updates: Record<string, 'subscribed' | 'unsubscribed'>) {
    if (!token) return;
    setSaving(true);
    try {
      const res = await fetch(`/p/preferences/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptions: updates }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success('Preferences saved');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-mesh p-6">
      <div className="w-full max-w-md rounded-xl border border-border/60 bg-card p-6 shadow-elevated">
        <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Email preferences</div>
        <h1 className="text-xl font-semibold tracking-tight">Manage your subscriptions</h1>
        {error ? (
          <p className="mt-4 rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        ) : !data ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.subscriber.email ? data.subscriber.email : data.subscriber.externalId}
            </p>
            <ul className="mt-6 space-y-3">
              {data.groups.map((g) => (
                <li key={g.id} className="flex items-start justify-between gap-3 rounded border border-border/60 p-3">
                  <div>
                    <div className="font-medium text-sm">{g.name}</div>
                    {g.description ? <div className="text-xs text-muted-foreground">{g.description}</div> : null}
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void save({
                        [String(g.id)]: g.status === 'subscribed' ? 'unsubscribed' : 'subscribed',
                      })
                    }
                    className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      g.status === 'subscribed'
                        ? 'border-success/40 bg-success/10 text-success-foreground hover:bg-success/20'
                        : 'border-muted text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {g.status === 'subscribed' ? 'Subscribed — click to unsubscribe' : 'Unsubscribed — click to resubscribe'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-6 text-center text-[11px] text-muted-foreground">Powered by Pipelineflow Engagement</p>
      </div>
    </div>
  );
}
