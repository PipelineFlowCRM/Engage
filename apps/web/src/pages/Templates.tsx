import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/utils';

interface Template {
  id: number;
  name: string;
  channel: string;
  status: 'draft' | 'published' | 'archived';
  updatedAt: string;
  subscriptionGroup: { id: number; name: string } | null;
}

export function Templates() {
  const { data, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ templates: Template[] }>('/templates'),
  });
  return (
    <div>
      <PageHeader
        title="Templates"
        description="MJML + Liquid email templates. Subscription group required before broadcasting."
        actions={<Button asChild variant="brand"><Link to="/templates/new">New template</Link></Button>}
      />
      <div className="p-6">
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Channel</th><th className="px-4 py-3">Subscription group</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Updated</th></tr>
              </thead>
              <tbody>
                {isLoading ? <tr><td colSpan={5} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
                : !data?.templates.length ? <tr><td colSpan={5} className="px-4 py-6 text-muted-foreground">No templates. <Link to="/templates/new" className="underline">Create one</Link>.</td></tr>
                : data.templates.map((t) => (
                  <tr key={t.id} className="border-b border-border/40 hover:bg-accent/40">
                    <td className="px-4 py-2.5 font-medium">
                      <Link to={`/templates/${t.id}`} className="hover:underline">{t.name}</Link>
                    </td>
                    <td className="px-4 py-2.5">{t.channel}</td>
                    <td className="px-4 py-2.5">{t.subscriptionGroup?.name ?? <span className="text-warning">none — required</span>}</td>
                    <td className="px-4 py-2.5"><Badge variant={t.status === 'published' ? 'success' : 'outline'}>{t.status}</Badge></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{relativeTime(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
