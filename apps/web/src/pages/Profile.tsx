import { useState } from 'react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { initials } from '@/lib/utils';

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
    onSuccess: () => { toast.success('Password changed'); setCur(''); setNext(''); setConf(''); },
    onError: (err: Error) => toast.error(err.message),
  });

  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [conf, setConf] = useState('');

  if (!user) return null;

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>How you appear across PipelineFlow Engagement.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
            className="space-y-5"
          >
            <div className="flex items-center gap-4">
              <Avatar className="h-14 w-14">
                <AvatarFallback className="text-sm">{initials(name || user.name)}</AvatarFallback>
              </Avatar>
              <div className="text-sm text-muted-foreground">
                Avatar uses your initials. Image upload arrives in a future release.
              </div>
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user.email} disabled className="max-w-md" />
            </div>

            <div className="space-y-2">
              <Label>Display name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="max-w-sm"
              />
            </div>

            <div className="space-y-2">
              <Label>Theme</Label>
              <select
                className="h-9 max-w-xs rounded-md border border-input bg-background px-3 text-sm"
                value={theme}
                onChange={(e) => setTheme(e.target.value as 'system' | 'light' | 'dark')}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                className="bg-gradient-brand text-white shadow-glow hover:opacity-90"
                disabled={save.isPending}
              >
                {save.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Use a long passphrase you don't reuse elsewhere.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate({ currentPassword: cur, newPassword: next, confirmPassword: conf });
            }}
            className="space-y-3"
          >
            <div className="space-y-2">
              <Label>Current password</Label>
              <Input
                type="password"
                autoComplete="current-password"
                value={cur}
                onChange={(e) => setCur(e.target.value)}
                required
                className="max-w-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>New password</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={8}
                className="max-w-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>Confirm new password</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={conf}
                onChange={(e) => setConf(e.target.value)}
                required
                minLength={8}
                className="max-w-sm"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="outline" disabled={change.isPending}>
                {change.isPending ? 'Updating…' : 'Update password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
