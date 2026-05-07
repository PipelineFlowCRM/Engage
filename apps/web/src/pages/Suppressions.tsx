import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/utils';

interface Suppression { email: string; reason: string; details: string | null; createdAt: string }

export function Suppressions() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['suppressions'],
    queryFn: () => api.get<{ suppressions: Suppression[] }>('/suppressions?limit=200'),
  });

  const [email, setEmail] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/suppressions', { email, reason: 'manual' }),
    onSuccess: () => {
      toast.success('Added');
      setEmail('');
      qc.invalidateQueries({ queryKey: ['suppressions'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const remove = useMutation({
    mutationFn: (e: string) => api.delete(`/suppressions/${encodeURIComponent(e)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppressions'] }),
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Add manually</CardTitle>
          <CardDescription>
            Hard blocklist — checked before every send. Hard bounces and complaints land here automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => { e.preventDefault(); add.mutate(); }}
            className="flex max-w-xl flex-wrap gap-2"
          >
            <Input
              type="email"
              required
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-w-[14rem] flex-1"
            />
            <Button
              type="submit"
              className="bg-gradient-brand text-white shadow-glow hover:opacity-90"
              disabled={add.isPending}
            >
              {add.isPending ? 'Adding…' : 'Add'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border/60 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {!data?.suppressions.length ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-muted-foreground">
                    Empty list — good news.
                  </td>
                </tr>
              ) : (
                data.suppressions.map((s) => (
                  <tr key={s.email} className="border-b border-border/40">
                    <td className="px-4 py-2.5 font-mono text-xs">{s.email}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={s.reason === 'manual' ? 'outline' : 'destructive'}>
                        {s.reason}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{relativeTime(s.createdAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(s.email)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
