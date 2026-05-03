// Mirror of apps/api/src/lib/render.ts. Same constraints (no fs, time-cap).
import { Liquid } from 'liquidjs';
import mjml2html from 'mjml';
import { htmlToText } from 'html-to-text';

const liquid = new Liquid({
  cache: true,
  strictFilters: false,
  strictVariables: false,
  root: [],
});

const MAX_LIQUID_RENDER_MS = 5_000;

async function renderLiquid(template: string, context: Record<string, unknown>): Promise<string> {
  const tpl = liquid.parse(template);
  const promise = liquid.render(tpl, context) as Promise<string>;
  let timeout: NodeJS.Timeout | null = null;
  const timer = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Liquid template timed out')), MAX_LIQUID_RENDER_MS);
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export interface RenderInput {
  subject: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  mjml: string;
  text?: string | null;
  context: Record<string, unknown>;
}

export interface RenderOutput {
  subject: string;
  html: string;
  text: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
}

export async function renderEmail(input: RenderInput): Promise<RenderOutput> {
  const subject = await renderLiquid(input.subject, input.context);
  const mjmlSource = await renderLiquid(input.mjml, input.context);
  // mjml2html is synchronous at runtime; @types/mjml@4.7.4 declares the
  // return as `Promise<MJMLParseResults>` (incorrect). Cast to the actual
  // shape rather than awaiting — awaiting a non-Promise still works but
  // makes flow control murkier.
  const mjmlOut = mjml2html(mjmlSource, { validationLevel: 'soft', minify: true }) as unknown as { html: string };
  const html = mjmlOut.html;
  const text = input.text
    ? await renderLiquid(input.text, input.context)
    : htmlToText(html, { wordwrap: 80 });
  return {
    subject,
    html,
    text,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    replyTo: input.replyTo ?? null,
  };
}
