// Tiny dependency-free XML/MJML pretty-printer.
//
// Splits the source on tag boundaries and re-indents based on open/close
// depth. Self-closing tags and HTML void elements don't push depth.
// Liquid tags (`{{ ... }}`, `{% ... %}`) are treated as text content and
// kept inline with surrounding text — they don't affect indent depth.
//
// Not a full XML parser: doesn't handle CDATA or processing instructions
// (MJML email templates don't need them). Comments are preserved on their
// own indented line.

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

const INDENT = '  ';

export function formatMjml(src: string): string {
  if (!src) return src;

  // Normalize CRLF, trim outer whitespace.
  let s = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  // Collapse whitespace runs that span only between tags so we can re-emit
  // clean indentation. Whitespace inside text content is preserved.
  // Split into tokens: opening tags, closing tags, comments, and text.
  const tokens: string[] = [];
  const re = /<!--[\s\S]*?-->|<\/?[^>]+?>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    tokens.push(m[0]);
  }

  const out: string[] = [];
  let depth = 0;
  for (const raw of tokens) {
    const t = raw;
    if (!t) continue;

    if (t.startsWith('<!--')) {
      out.push(INDENT.repeat(depth) + t.trim());
      continue;
    }

    if (t.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      out.push(INDENT.repeat(depth) + t.trim());
      continue;
    }

    if (t.startsWith('<')) {
      const tagName = t.match(/^<\s*([A-Za-z][A-Za-z0-9-]*)/)?.[1]?.toLowerCase() ?? '';
      const selfClosing = /\/\s*>$/.test(t) || VOID_TAGS.has(tagName);
      out.push(INDENT.repeat(depth) + t.trim());
      if (!selfClosing) depth++;
      continue;
    }

    // Text node. Trim leading/trailing whitespace, but preserve interior
    // spacing (so `Hi {{ subscriber.firstName }}` stays intact). Skip if
    // empty after trimming so we don't emit a blank indented line.
    const text = t.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push(INDENT.repeat(depth) + text);
  }

  return out.join('\n');
}
