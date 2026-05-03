import { useState } from 'react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';

export function Profile() {
  const { user, refresh } = useAuth();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(user?.name ?? '');

  const save = useMutation({
    mutationFn: () => api.patch('/profile', { name }),
    onSuccess: async () => { toast.success('Profile saved'); await refresh(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const change = useMutation({
    mutationFn: (vars: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
      api.post('/auth/change-password', vars),
    onSuccess: () => toast.success('Password changed'),
    onError: (err: Error) => toast.error(err.message),
  });

  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [conf, setConf] = useState('');

  return (
    <div>
      <PageHeader title="Profile" description="Operator account settings." />
      <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Account</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
              <div className="space-y-2"><Label>Email</Label><Input value={user?.email ?? ''} disabled /></div>
              <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-2">
                <Label>Theme</Label>
                <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={theme} onChange={(e) => setTheme(e.target.value as 'system' | 'light' | 'dark')}>
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <Button type="submit" variant="brand" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Change password</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); change.mutate({ currentPassword: cur, newPassword: next, confirmPassword: conf }); }} className="space-y-3">
              <div className="space-y-2"><Label>Current password</Label><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required /></div>
              <div className="space-y-2"><Label>New password</Label><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} /></div>
              <div className="space-y-2"><Label>Confirm new password</Label><Input type="password" value={conf} onChange={(e) => setConf(e.target.value)} required minLength={8} /></div>
              <Button type="submit" variant="outline" disabled={change.isPending}>Change password</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
