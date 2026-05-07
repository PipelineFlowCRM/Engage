import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatMjml } from '@/lib/mjmlFormat';

const STARTER_MJML = `<mjml>
  <mj-body background-color="#f8fafc">
    <mj-section>
      <mj-column>
        <mj-text font-size="20px" font-weight="600">Hi {{ subscriber.firstName | default: "there" }} 👋</mj-text>
        <mj-text>This is a preview email. Edit me!</mj-text>
        <mj-button href="https://example.com">Click me</mj-button>
        <mj-text font-size="11px" color="#64748b">
          You can unsubscribe at any time:
          <a href="{{ unsubscribe_url }}">manage preferences</a>.
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

interface Group { id: number; name: string }

export function TemplateEditor() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = idParam ? Number(idParam) : null;
  const isNew = id == null;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const groups = useQuery({
    queryKey: ['subscription-groups'],
    queryFn: () => api.get<{ subscriptionGroups: Group[] }>('/subscription-groups'),
  });

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [mjml, setMjml] = useState(STARTER_MJML);
  const [text, setText] = useState('');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const existing = useQuery({
    queryKey: ['template', id],
    queryFn: () => api.get<{ template: { name: string; subscriptionGroupId: number | null; definition: { subject: string; fromName: string; fromEmail: string; replyTo?: string | null; mjml: string; text?: string | null } } }>(`/templates/${id}`),
    enabled: Boolean(id),
  });
  useEffect(() => {
    if (hydrated) return;
    if (existing.data?.template) {
      const t = existing.data.template;
      setName(t.name);
      setGroupId(t.subscriptionGroupId);
      setSubject(t.definition.subject);
      setFromName(t.definition.fromName);
      setFromEmail(t.definition.fromEmail);
      setReplyTo(t.definition.replyTo ?? '');
      // Pretty-print on load so single-line / collapsed MJML displays
      // legibly. The user's edits are preserved verbatim from there.
      setMjml(formatMjml(t.definition.mjml));
      setText(t.definition.text ?? '');
      setHydrated(true);
    }
  }, [existing.data, hydrated]);

  const definition = useMemo(() => ({
    subject, fromName, fromEmail,
    replyTo: replyTo || null,
    mjml,
    text: text || null,
  }), [subject, fromName, fromEmail, replyTo, mjml, text]);

  const previewMutation = useMutation({
    mutationFn: () => api.post<{ preview: { subject: string; html: string; warnings: string[] } }>('/templates/preview', { definition }),
    onSuccess: (res) => { setPreviewHtml(res.preview.html); setPreviewWarnings(res.preview.warnings); },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = { name, channel: 'email', definition, subscriptionGroupId: groupId };
      return isNew
        ? api.post('/templates', body)
        : api.patch(`/templates/${id}`, body);
    },
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['templates'] });
      if (!isNew) qc.invalidateQueries({ queryKey: ['template', id] });
      navigate('/templates');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <PageHeader
        title={isNew ? 'New template' : 'Edit template'}
        description="Author MJML + Liquid. Live preview renders against sample subscriber traits."
        actions={
          <>
            <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}>
              {previewMutation.isPending ? 'Rendering…' : 'Preview'}
            </Button>
            <Button variant="brand" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-2">
        <Card className="space-y-0">
          <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Name" v={name} onChange={setName} />
            <div className="space-y-2">
              <Label>Subscription group <span className="text-destructive">*</span></Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={groupId ?? ''}
                onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— select —</option>
                {groups.data?.subscriptionGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Required. Sends without a group are blocked.</p>
            </div>
            <Field label="Subject" v={subject} onChange={setSubject} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="From name" v={fromName} onChange={setFromName} />
              <Field label="From email" v={fromEmail} onChange={setFromEmail} />
            </div>
            <Field label="Reply-to" v={replyTo} onChange={setReplyTo} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle>MJML body</CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMjml((m) => formatMjml(m))}
              title="Re-indent the MJML"
            >
              Format
            </Button>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={26}
              spellCheck={false}
              wrap="off"
              className="whitespace-pre font-mono text-[11px] leading-relaxed"
              value={mjml}
              onChange={(e) => setMjml(e.target.value)}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Plaintext fallback (optional)</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              rows={8}
              spellCheck={false}
              className="whitespace-pre-wrap font-mono text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Leave blank to derive from HTML"
            />
          </CardContent>
        </Card>

        {previewHtml ? (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Preview</CardTitle></CardHeader>
            <CardContent>
              {previewWarnings.length ? (
                <ul className="mb-3 space-y-1 text-xs text-warning">
                  {previewWarnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                </ul>
              ) : null}
              <iframe title="preview" className="h-[600px] w-full rounded border border-border" srcDoc={previewHtml} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, v, onChange }: { label: string; v: string; onChange: (s: string) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={v} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
