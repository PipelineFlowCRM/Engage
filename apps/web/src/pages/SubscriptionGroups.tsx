import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface Group { id: number; name: string; type: 'opt_in' | 'opt_out'; description: string | null; channel: string }

export function SubscriptionGroups() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['subscription-groups'],
    queryFn: () => api.get<{ subscriptionGroups: Group[] }>('/subscription-groups'),
  });

  const [name, setName] = useState('');
  const [type, setType] = useState<'opt_in' | 'opt_out'>('opt_out');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () => api.post('/subscription-groups', { name, type, description: description || null }),
    onSuccess: () => {
      toast.success('Created');
      setName('');
      setDescription('');
      qc.invalidateQueries({ queryKey: ['subscription-groups'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Existing groups</CardTitle>
          <CardDescription>
            Opt-in / opt-out lists. Templates must reference one before broadcasting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!data?.subscriptionGroups.length ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            data.subscriptionGroups.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{g.name}</div>
                  {g.description ? (
                    <div className="truncate text-xs text-muted-foreground">{g.description}</div>
                  ) : null}
                </div>
                <Badge variant="outline">{g.type}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>New group</CardTitle>
          <CardDescription>Create a list operators can subscribe contacts to.</CardDescription>
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
              <Label>Type</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value as 'opt_in' | 'opt_out')}
              >
                <option value="opt_out">opt_out (subscribed by default)</option>
                <option value="opt_in">opt_in (must subscribe before send)</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                className="bg-gradient-brand text-white shadow-glow hover:opacity-90"
                disabled={create.isPending}
              >
                {create.isPending ? 'Creating…' : 'Create group'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
