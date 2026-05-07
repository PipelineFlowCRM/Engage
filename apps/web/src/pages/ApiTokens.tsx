import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { API_TOKEN_SCOPES } from '@pipelineflow-engagement/shared';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/utils';

interface Token {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function ApiTokens() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => api.get<{ tokens: Token[] }>('/api-tokens'),
  });

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['engagement:ingest']);
  const [issued, setIssued] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ secret: string }>('/api-tokens', { name, scopes }),
    onSuccess: (res) => {
      setIssued(res.secret);
      setName('');
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/api-tokens/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens'] }),
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>New token</CardTitle>
          <CardDescription>
            Bearer tokens for /api/public/track and admin automation. Shown only once at creation — copy immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
            className="space-y-3"
          >
            <div className="space-y-2">
              <Label>Name</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Scopes</Label>
              <div className="space-y-1">
                {API_TOKEN_SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={scopes.includes(s)}
                      onChange={() =>
                        setScopes((prev) =>
                          prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
                        )
                      }
                    />{' '}
                    <span className="font-mono text-xs">{s}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                className="bg-gradient-brand text-white shadow-glow hover:opacity-90"
                disabled={create.isPending || !scopes.length}
              >
                {create.isPending ? 'Creating…' : 'Create token'}
              </Button>
            </div>
          </form>
          {issued ? (
            <div className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
              <p className="mb-2 font-medium">Your new token (save it now — it won't be shown again):</p>
              <pre className="overflow-x-auto rounded bg-background p-2 font-mono">{issued}</pre>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  void navigator.clipboard.writeText(issued);
                  toast.success('Copied');
                }}
              >
                Copy
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active tokens</CardTitle>
          <CardDescription>Revoke a token to immediately invalidate it.</CardDescription>
        </CardHeader>
        <CardContent>
          {!data?.tokens.length ? (
            <p className="text-sm text-muted-foreground">No tokens.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {data.tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{t.name}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{t.id}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.scopes.map((s) => (
                        <Badge key={s} variant="outline" className="text-[10px]">
                          {s}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t.revokedAt
                        ? `revoked ${relativeTime(t.revokedAt)}`
                        : t.lastUsedAt
                          ? `last used ${relativeTime(t.lastUsedAt)}`
                          : 'never used'}
                    </div>
                  </div>
                  {!t.revokedAt ? (
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(t.id)}>
                      Revoke
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
