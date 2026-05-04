import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { audienceDefinitionSchema, audienceCreateSchema } from '@pipelineflow-engagement/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const SAMPLE_DEFINITION = JSON.stringify(
  {
    root: {
      type: 'And',
      children: [
        { type: 'Trait', key: 'plan', operator: 'equals', value: 'pro' },
        {
          type: 'Performed',
          event: 'opened_app',
          window: { kind: 'lastDays', days: 30 },
          times: { op: 'gte', count: 1 },
        },
      ],
    },
  },
  null, 2,
);

export function AudienceEditor() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = idParam ? Number(idParam) : null;
  const isNew = id == null;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [intervalMin, setIntervalMin] = useState(5);
  const [defText, setDefText] = useState(SAMPLE_DEFINITION);
  const [defError, setDefError] = useState<string | null>(null);
  // Guard against background refetches reverting in-progress edits. We
  // hydrate from `existing.data` exactly once.
  const [hydrated, setHydrated] = useState(false);

  const existing = useQuery({
    queryKey: ['audience', id],
    queryFn: () => api.get<{ audience: { name: string; description: string | null; computeIntervalSeconds: number; definition: unknown } }>(`/audiences/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (hydrated) return;
    if (existing.data?.audience) {
      setName(existing.data.audience.name);
      setDescription(existing.data.audience.description ?? '');
      setIntervalMin(Math.round(existing.data.audience.computeIntervalSeconds / 60));
      setDefText(JSON.stringify(existing.data.audience.definition, null, 2));
      setHydrated(true);
    }
  }, [existing.data, hydrated]);

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post('/audiences', body),
    onSuccess: () => { toast.success('Audience created'); qc.invalidateQueries({ queryKey: ['audiences'] }); navigate('/audiences'); },
    onError: (err: Error) => toast.error(err.message),
  });
  const updateMutation = useMutation({
    mutationFn: (body: object) => api.patch(`/audiences/${id}`, body),
    onSuccess: () => {
      toast.success('Audience saved');
      qc.invalidateQueries({ queryKey: ['audiences'] });
      qc.invalidateQueries({ queryKey: ['audience', id] });
      navigate('/audiences');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDefError(null);
    let parsed: unknown;
    try { parsed = JSON.parse(defText); }
    catch (err) { setDefError(`JSON parse error: ${err instanceof Error ? err.message : err}`); return; }
    const v = audienceDefinitionSchema.safeParse(parsed);
    if (!v.success) {
      setDefError(JSON.stringify(v.error.format(), null, 2));
      return;
    }
    const body = {
      name,
      description: description || null,
      definition: v.data,
      computeIntervalSeconds: intervalMin * 60,
    };
    if (isNew) {
      const validate = audienceCreateSchema.safeParse(body);
      if (!validate.success) { toast.error('Invalid form'); return; }
      createMutation.mutate(body);
    } else {
      updateMutation.mutate(body);
    }
  };

  return (
    <div>
      <PageHeader title={isNew ? 'New audience' : `Edit audience`} description="Define membership as a JSON tree of And/Or/Trait/Performed nodes." />
      <form onSubmit={onSubmit} className="space-y-4 p-6">
        <Card>
          <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="interval">Compute interval (minutes)</Label>
              <Input id="interval" type="number" min={1} max={1440} value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} />
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label htmlFor="desc">Description</Label>
              <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Definition (JSON)</CardTitle>
            <p className="text-sm text-muted-foreground">
              Schema: nested <code className="font-mono">{`{ root: <node> }`}</code> where node ∈ <code className="font-mono">And | Or | Trait | Performed</code>.
            </p>
          </CardHeader>
          <CardContent>
            <Textarea rows={20} className="font-mono text-xs" value={defText} onChange={(e) => setDefText(e.target.value)} />
            {defError ? <pre className="mt-3 rounded bg-destructive/10 p-3 text-xs text-destructive whitespace-pre-wrap">{defError}</pre> : null}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/audiences')}>Cancel</Button>
          <Button type="submit" variant="brand" disabled={createMutation.isPending || updateMutation.isPending}>
            {createMutation.isPending || updateMutation.isPending ? 'Saving…' : 'Save audience'}
          </Button>
        </div>
      </form>
    </div>
  );
}
