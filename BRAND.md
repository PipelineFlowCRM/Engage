# PipelineFlow Engagement Brand Guidelines

Brand palette and usage tokens for **PipelineFlow Engagement** — the omni-channel marketing automation and transactional messaging companion to [PipelineFlow CRM](https://github.com/PipelineFlowCRM/PipelineFlow).

This document is the source of truth for colors, gradients, and typographic choices used across the app, marketing site, and visual assets.

## Product family relationship

PipelineFlow is a brand family. The parent product (CRM) and Engagement share visual DNA but each has its own identity gradient:

| Product | Gradient |
|---------|----------|
| PipelineFlow (CRM) | Blue → Cyan → Teal (`#2563EB → #0891B2 → #14B8A6`) |
| **PipelineFlow Engagement** | **Indigo → Fuchsia → Pink (`#4F46E5 → #9333EA → #EC4899`)** |

The wordmark "PipelineFlow" always renders identically across products — "Pipeline" in slate, "Flow" in the original blue→teal gradient. Each product appends its own name in its own product gradient, producing a clear family system that scales as new products are added.

## Brand assets

The primary visual assets live in the project repo under `/assets`:

- `logo-icon.svg` / `.png` — square icon (avatars, favicons, social cards)
- `logo.svg` / `.png` — stacked lockup (icon + "PipelineFlow Engagement")
- `feature-graphic.svg` / `.png` — README banner / Open Graph image

## Brand gradient

The signature visual element. A diagonal sweep from indigo through fuchsia to pink — warmer than the CRM, signaling messaging and engagement.

| Stop | Hex | Position |
|------|-----|----------|
| Brand Indigo 600 | `#4F46E5` | 0% |
| Brand Purple 600 | `#9333EA` | 55% |
| Brand Pink 500 | `#EC4899` | 100% |

CSS:

```css
--brand-gradient: linear-gradient(135deg, #4F46E5 0%, #9333EA 55%, #EC4899 100%);
```

Use the gradient on: the logo icon background, the "Engagement" suffix in the wordmark, hero CTAs, hero headlines, "active" workflow accents, and decorative chart fills.

## Primary brand colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--brand-indigo` | `#4F46E5` | Primary buttons, links, focus rings |
| `--brand-purple` | `#9333EA` | Hover states, secondary accents |
| `--brand-pink` | `#EC4899` | Tertiary accents, decorative highlights |

Lighter tints used for icon backgrounds and dot fills:

| Token | Hex |
|-------|-----|
| `--indigo-500` | `#6366F1` |
| `--purple-500` | `#A855F7` |
| `--pink-500` | `#EC4899` |

## Channel colors

Used for channel badges, workflow node accents, message-type tags, and analytics charts. Each channel has a saturated accent and a soft tint.

| Channel | Accent | Tint | Use |
|---------|--------|------|-----|
| Trigger / Event | `#10B981` | `#ECFDF5` | Workflow triggers, signups, automation entry points |
| Email | `#4F46E5` | `#EEF2FF` | Email nodes, email campaigns, email metrics |
| SMS | `#9333EA` | `#FAF5FF` | SMS nodes, text campaigns |
| Push | `#EC4899` | `#FDF2F8` | Push notification nodes, mobile alerts |
| In-app (suggested) | `#06B6D4` | `#ECFEFF` | In-app messages, banners, toasts |
| WhatsApp (suggested) | `#22C55E` | `#F0FDF4` | If/when WhatsApp Business is supported |

These colors are paired with channel icons (envelope, phone, bell, etc.) inside a 24×24 rounded square in workflow nodes.

## Workflow node colors

The workflow builder uses a consistent visual language — every node is a white card with a colored left accent bar (4px wide) and a colored icon container.

| Node type | Accent |
|-----------|--------|
| Trigger | `#10B981` (Emerald) |
| Email | `#4F46E5` (Indigo) |
| SMS | `#9333EA` (Purple) |
| Push | `#EC4899` (Pink) |
| Wait / Delay | `#64748B` (Slate 500) |
| Branch / Condition | `#94A3B8` (Slate 400) |
| Goal / Conversion | `#10B981` (Emerald) |
| Exit / End | `#EF4444` (Red) |

Wait, branch, and exit pills use a neutral background (`#F1F5F9`) with the accent color for the icon only.

## Neutrals

Tailwind's Slate scale. Used for text, borders, surfaces, and chrome — identical to PipelineFlow CRM for cross-product consistency.

| Token | Hex | Usage |
|-------|-----|-------|
| `--slate-900` | `#0F172A` | Headings, primary text |
| `--slate-800` | `#1E293B` | Strong text |
| `--slate-700` | `#334155` | Body text |
| `--slate-500` | `#64748B` | Secondary text, labels |
| `--slate-400` | `#94A3B8` | Muted text, disabled icons |
| `--slate-300` | `#CBD5E1` | Borders, input outlines |
| `--slate-200` | `#E2E8F0` | Dividers, card borders |
| `--slate-100` | `#F1F5F9` | Inline pill backgrounds |
| `--slate-50` | `#F8FAFC` | Page background, subtle surfaces |
| `--white` | `#FFFFFF` | Card surfaces, modals |

## Semantic colors

Identical to PipelineFlow CRM.

| State | Foreground | Background | Text-on-bg |
|-------|-----------|-----------|-----------|
| Success | `#10B981` | `#ECFDF5` | `#047857` |
| Warning | `#F59E0B` | `#FEF3C7` | `#92400E` |
| Danger | `#EF4444` | `#FEE2E2` | `#991B1B` |
| Info | `#3B82F6` | `#DBEAFE` | `#1E40AF` |

## App background

A very soft diagonal gradient on light surfaces gives marketing pages and dashboards a hint of brand without being noisy.

```css
background: linear-gradient(135deg, #EEF2FF 0%, #FDF2F8 100%);
```

For solid surfaces, use `#F8FAFC` (slate-50) as the page background. For workflow canvases, use `#FAF5FF` (a hint of purple) as the canvas tint.

## Typography

Same as PipelineFlow CRM — Inter is preferred; Poppins is the fallback used in rendered marketing assets.

```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
             'Helvetica Neue', Arial, sans-serif;
```

Weights in use:

- 800 (ExtraBold) — headlines, the "Flow" half of the wordmark, big numbers
- 600–700 (SemiBold / Bold) — subheadings, card titles, CTAs, the "Engagement" suffix in the wordmark
- 500 (Medium) — body text, the "Pipeline" half of the wordmark
- 400 (Regular) — long-form copy

Letter spacing of `-0.02em` to `-0.035em` on display sizes (40px+) keeps the geometric look tight.

## Wordmark composition

The "PipelineFlow Engagement" wordmark stacks on two lines and uses three styles:

- "Pipeline" — Slate 900 (`#0F172A`), weight 600 (medium)
- "Flow" — Original PipelineFlow gradient (`#2563EB → #14B8A6`), weight 800 (extrabold)
- "Engagement" — Engagement gradient (`#4F46E5 → #9333EA → #EC4899`), weight 600 (semibold), positioned below "PipelineFlow"

Layout:

```
[icon]  PipelineFlow
        Engagement
```

The two-line stack keeps the parent brand intact while clearly identifying the product. For very horizontal layouts (header bars under 80px tall), the Engagement gradient suffix can be omitted entirely — just "PipelineFlow" plus the Engagement icon is enough to identify the product.

## CSS custom properties (drop-in)

```css
:root {
  /* Engagement brand */
  --brand-indigo: #4F46E5;
  --brand-purple: #9333EA;
  --brand-pink: #EC4899;
  --brand-gradient: linear-gradient(135deg, #4F46E5 0%, #9333EA 55%, #EC4899 100%);
  --brand-bg-gradient: linear-gradient(135deg, #EEF2FF 0%, #FDF2F8 100%);

  /* Light variants */
  --indigo-500: #6366F1;
  --purple-500: #A855F7;

  /* Channels */
  --channel-trigger:      #10B981;
  --channel-trigger-tint: #ECFDF5;
  --channel-email:        #4F46E5;
  --channel-email-tint:   #EEF2FF;
  --channel-sms:          #9333EA;
  --channel-sms-tint:     #FAF5FF;
  --channel-push:         #EC4899;
  --channel-push-tint:    #FDF2F8;
  --channel-inapp:        #06B6D4;
  --channel-inapp-tint:   #ECFEFF;
  --channel-whatsapp:     #22C55E;
  --channel-whatsapp-tint:#F0FDF4;

  /* Workflow nodes */
  --node-wait:    #64748B;
  --node-branch:  #94A3B8;
  --node-goal:    #10B981;
  --node-exit:    #EF4444;

  /* Neutrals (shared with CRM) */
  --slate-900: #0F172A;
  --slate-800: #1E293B;
  --slate-700: #334155;
  --slate-500: #64748B;
  --slate-400: #94A3B8;
  --slate-300: #CBD5E1;
  --slate-200: #E2E8F0;
  --slate-100: #F1F5F9;
  --slate-50:  #F8FAFC;

  /* Semantic */
  --success: #10B981;
  --success-bg: #ECFDF5;
  --success-text: #047857;
  --warning: #F59E0B;
  --warning-bg: #FEF3C7;
  --warning-text: #92400E;
  --danger: #EF4444;
  --danger-bg: #FEE2E2;
  --danger-text: #991B1B;
  --info: #3B82F6;
  --info-bg: #DBEAFE;
  --info-text: #1E40AF;

  /* Cross-product reference (for the "Flow" wordmark gradient) */
  --crm-gradient: linear-gradient(90deg, #2563EB 0%, #14B8A6 100%);
}
```

## Tailwind config snippet

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          indigo: '#4F46E5',
          purple: '#9333EA',
          pink:   '#EC4899',
        },
        channel: {
          trigger:  { DEFAULT: '#10B981', tint: '#ECFDF5' },
          email:    { DEFAULT: '#4F46E5', tint: '#EEF2FF' },
          sms:      { DEFAULT: '#9333EA', tint: '#FAF5FF' },
          push:     { DEFAULT: '#EC4899', tint: '#FDF2F8' },
          inapp:    { DEFAULT: '#06B6D4', tint: '#ECFEFF' },
          whatsapp: { DEFAULT: '#22C55E', tint: '#F0FDF4' },
        },
        node: {
          wait:   '#64748B',
          branch: '#94A3B8',
          goal:   '#10B981',
          exit:   '#EF4444',
        },
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #4F46E5 0%, #9333EA 55%, #EC4899 100%)',
        'brand-bg':       'linear-gradient(135deg, #EEF2FF 0%, #FDF2F8 100%)',
        'crm-gradient':   'linear-gradient(90deg, #2563EB 0%, #14B8A6 100%)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI',
               'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
};
```

## Usage notes

- Prefer the solid `#4F46E5` (Indigo 600) for default UI elements (buttons, links, focus). Reserve the gradient for hero moments — the logo, the headline, the primary CTA on landing pages, "Live" workflow status indicators.
- Don't put the brand gradient under body text — contrast suffers. If you need a gradient surface behind text, use `--brand-bg-gradient` (the soft pastel version).
- Channel colors are semantic — never use the email indigo for a destructive action, and never use the push pink for a generic "active" indicator. Channel color encodes channel type and should be consistent everywhere a user sees a message type (workflow nodes, campaign list, analytics charts, audit log).
- Keep node accents thin (4px left bar) and let the icon do the bulk of channel identification. Stacked nodes with thick color bars get noisy.
- The wordmark should never be recolored as a single solid color. If a single-color version is needed (e.g. monochrome print), use Slate 900 for "Pipeline" and "Engagement" and keep "Flow" in slate-900 as well — drop both gradients in monochrome contexts rather than picking one to keep.
- When PipelineFlow CRM and PipelineFlow Engagement appear side by side (e.g. in a product picker), let the icons distinguish them — the gradient does the work. Don't introduce additional visual differentiators (different fonts, different lockup styles).
