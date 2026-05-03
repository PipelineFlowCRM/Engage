import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function BroadcastEditor() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = idParam ? Number(idParam) : null;
  const isNew = id == null;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const audiences = useQuery({
    queryKey: ['audiences'],
    queryFn: () => api.get<{ audiences: Array<{ id: number; name: string; memberCount: number; status: string }> }>('/audiences'),
  });
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ templates: Array<{ id: number; name: string; status: string; subscriptionGroup: { name: string } | null }> }>('/templates'),
  });
  const existing = useQuery({
    queryKey: ['broadcast', id],
    queryFn: () => api.get<{ broadcast: { name: string; templateId: number; audienceId: number; sendRatePerSecond: number; scheduledFor: string | null } }>(`/broadcasts/${id}`),
    enabled: Boolean(id),
  });

  const [name, setName] = useState('');
  const [audienceId, setAudienceId] = useState<number | null>(null);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [scheduledFor, setScheduledFor] = useState('');
  const [rate, setRate] = useState(10);

  useEffect(() => {
    if (existing.data?.broadcast) {
      setName(existing.data.broadcast.name);
      setAudienceId(existing.data.broadcast.audienceId);
      setTemplateId(existing.data.broadcast.templateId);
      setScheduledFor(existing.data.broadcast.scheduledFor ?? '');
      setRate(existing.data.broadcast.sendRatePerSecond);
    }
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        audienceId: audienceId!,
        templateId: templateId!,
        scheduledFor: scheduledFor || null,
        sendRatePerSecond: rate,
      };
      return isNew ? api.post('/broadcasts', body) : api.patch(`/broadcasts/${id}`, body);
    },
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['broadcasts'] }); navigate('/broadcasts'); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <PageHeader
        title={isNew ? 'New broadcast' : 'Edit broadcast'}
        description="Choose an audience and a published template. Schedule or save as draft."
      />
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4 p-6">
        <Card>
          <CardHeader><CardTitle>Setup</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Name</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Audience</Label>
              <select
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={audienceId ?? ''}
                onChange={(e) => setAudienceId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— select —</option>
                {audiences.data?.audiences.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} — {a.memberCount} members</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Template</Label>
              <select
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={templateId ?? ''}
                onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— select —</option>
                {templates.data?.templates.map((t) => (
                  <option key={t.id} value={t.id} disabled={!t.subscriptionGroup}>
                    {t.name}{t.subscriptionGroup ? '' : ' (no subscription group)'}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Schedule for (optional)</Label>
              <Input type="datetime-local" value={scheduledFor.slice(0, 16)} onChange={(e) => setScheduledFor(e.target.value ? new Date(e.target.value).toISOString() : '')} />
            </div>
            <div className="space-y-2">
              <Label>Send rate (per second)</Label>
              <Input type="number" min={1} max={1000} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
            </div>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/broadcasts')}>Cancel</Button>
          <Button type="submit" variant="brand" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </div>
  );
}
