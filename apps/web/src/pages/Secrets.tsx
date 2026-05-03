import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/utils';

interface Secret { id: number; name: string; createdAt: string; updatedAt: string }

export function Secrets() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['secrets'], queryFn: () => api.get<{ secrets: Secret[] }>('/secrets') });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ settings: Array<{ key: string; value: unknown }> }>('/admin/settings'), refetchInterval: 30_000 });

  const [region, setRegion] = useState('us-east-1');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [defaultFromDomain, setDefaultFromDomain] = useState('');

  const save = useMutation({
    mutationFn: () => api.post('/secrets', {
      name: 'amazon-ses',
      value: {
        region,
        accessKeyId,
        secretAccessKey,
        ...(defaultFromDomain ? { defaultFromDomain } : {}),
      },
    }),
    onSuccess: () => { toast.success('SES secret saved — restart workers to pick up new credentials'); setAccessKeyId(''); setSecretAccessKey(''); qc.invalidateQueries({ queryKey: ['secrets'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const sesQuota = settings?.settings.find((s) => s.key === 'ses.quota')?.value as
    | { sendingEnabled: boolean; productionAccessEnabled: boolean; max24h: number; maxSendRate: number; sentLast24h: number; pollAt: string }
    | undefined;

  const sesSecret = data?.secrets.find((s) => s.name === 'amazon-ses');

  return (
    <div>
      <PageHeader title="Secrets / AWS SES" description="Encrypted credentials for sending. Live SES quota displays once configured." />
      <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>AWS SES</CardTitle></CardHeader>
          <CardContent>
            {sesSecret ? (
              <div className="mb-4 rounded-md border border-success/40 bg-success/5 p-3 text-xs">
                Configured · last updated {relativeTime(sesSecret.updatedAt)}
              </div>
            ) : (
              <div className="mb-4 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
                Not configured — broadcast launches will fail until you save credentials.
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Region</Label><Input value={region} onChange={(e) => setRegion(e.target.value)} /></div>
                <div className="space-y-2"><Label>Default from domain (optional)</Label><Input value={defaultFromDomain} onChange={(e) => setDefaultFromDomain(e.target.value)} /></div>
              </div>
              <div className="space-y-2"><Label>Access key ID</Label><Input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} required /></div>
              <div className="space-y-2"><Label>Secret access key</Label><Input type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} required /></div>
              <Button type="submit" variant="brand" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Live SES quota</CardTitle></CardHeader>
          <CardContent>
            {!sesQuota ? <p className="text-sm text-muted-foreground">Waiting for first quota poll. The worker polls every 60s once SES creds are saved.</p>
            : (
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between"><span className="text-muted-foreground">Production access</span>{sesQuota.productionAccessEnabled ? <Badge variant="success">enabled</Badge> : <Badge variant="warning">sandbox</Badge>}</li>
                <li className="flex justify-between"><span className="text-muted-foreground">Sending</span>{sesQuota.sendingEnabled ? <Badge variant="success">on</Badge> : <Badge variant="destructive">paused</Badge>}</li>
                <li className="flex justify-between"><span className="text-muted-foreground">Daily quota</span><span className="tabular-nums">{sesQuota.sentLast24h.toLocaleString()} / {sesQuota.max24h.toLocaleString()}</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">Max send rate</span><span className="tabular-nums">{sesQuota.maxSendRate}/sec</span></li>
                <li className="flex justify-between text-xs text-muted-foreground"><span>Last poll</span><span>{relativeTime(sesQuota.pollAt)}</span></li>
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
