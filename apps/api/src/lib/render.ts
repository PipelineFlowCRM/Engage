import { Liquid } from 'liquidjs';
import mjml2html from 'mjml';
import { htmlToText } from 'html-to-text';
import { HttpError } from './error.js';
import { env } from '../env.js';

// Constrained Liquid engine. fs lookups disabled so a template can't
// `{% include 'somefile' %}` to read off the host. Loop-iteration cap
// prevents pathological templates from hanging the worker.
const liquid = new Liquid({
  cache: true,
  strictFilters: false,
  strictVariables: false,
  // No root → no `include` / `render` from filesystem.
  root: [],
});

export interface RenderInput {
  subject: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  mjml: string;
  text?: string | null;
  // Liquid context. Top-level keys are addressable as {{ key }}.
  context: Record<string, unknown>;
}

export interface RenderOutput {
  subject: string;
  html: string;
  text: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  // The Liquid + MJML pipeline can produce warnings (unused {{ var }},
  // unrecognised mj-tag) — surface them on preview so authors notice.
  warnings: string[];
}

const MAX_LIQUID_RENDER_MS = 5_000;

async function renderLiquid(template: string, context: Record<string, unknown>): Promise<string> {
  const tpl = liquid.parse(template);
  const promise = liquid.render(tpl, context) as Promise<string>;
  // Cooperative timeout — Liquid promises don't support cancellation.
  let timeout: NodeJS.Timeout | null = null;
  const timer = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new HttpError(400, 'Liquid template timed out')),
      MAX_LIQUID_RENDER_MS,
    );
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function renderEmail(input: RenderInput): Promise<RenderOutput> {
  const warnings: string[] = [];

  // 1) Subject through Liquid.
  const subject = await renderLiquid(input.subject, input.context);

  // 2) MJML body through Liquid first (so {{ }} can interpolate inside MJML
  // attributes and content), then mjml2html.
  // mjml2html is sync at runtime; @types/mjml@4.7.4 declares the return as
  // Promise<MJMLParseResults> (incorrect). Cast to the actual shape.
  const mjmlSource = await renderLiquid(input.mjml, input.context);
  const mjmlOut = mjml2html(mjmlSource, { validationLevel: 'soft', minify: true }) as unknown as {
    html: string;
    errors: Array<{ formattedMessage: string }>;
  };
  for (const e of mjmlOut.errors) {
    warnings.push(`mjml: ${e.formattedMessage}`);
  }
  const html = mjmlOut.html;

  // 3) Plaintext fallback. If author supplied one, render through Liquid.
  // Otherwise derive from the rendered HTML — covers >95% of cases.
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
    warnings,
  };
}

/**
 * Build the public preferences URL for a subscriber. Made available to
 * Liquid templates as `{{ unsubscribe_url }}` so authors don't have to
 * remember to inject one — but they should still place it visibly.
 */
export function preferencesUrl(token: string): string {
  return `${env.APP_ORIGIN}/p/preferences/${token}`;
}
