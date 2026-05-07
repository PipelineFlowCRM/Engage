import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1400px' } },
    extend: {
      fontFamily: {
        sans: [
          'Inter', 'ui-sans-serif', 'system-ui', '-apple-system',
          'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"',
          'Arial', 'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))' },
        warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))' },
        info: { DEFAULT: 'hsl(var(--info))', foreground: 'hsl(var(--info-foreground))' },
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          foreground: 'hsl(var(--brand-foreground))',
          indigo: '#4F46E5',
          purple: '#9333EA',
          pink:   '#EC4899',
        },
        // Channel semantic colors (BRAND.md). Each channel has an accent +
        // a soft tint used for icon backgrounds and chart fills.
        channel: {
          trigger:  { DEFAULT: '#10B981', tint: '#ECFDF5' },
          email:    { DEFAULT: '#4F46E5', tint: '#EEF2FF' },
          sms:      { DEFAULT: '#9333EA', tint: '#FAF5FF' },
          push:     { DEFAULT: '#EC4899', tint: '#FDF2F8' },
          inapp:    { DEFAULT: '#06B6D4', tint: '#ECFEFF' },
          whatsapp: { DEFAULT: '#22C55E', tint: '#F0FDF4' },
        },
        // Workflow node accents.
        node: {
          trigger: '#10B981',
          email:   '#4F46E5',
          sms:     '#9333EA',
          push:    '#EC4899',
          wait:    '#64748B',
          branch:  '#94A3B8',
          goal:    '#10B981',
          exit:    '#EF4444',
        },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      backgroundImage: {
        'gradient-brand': 'var(--gradient-brand)',
        'gradient-brand-bg': 'var(--gradient-brand-bg)',
        'gradient-crm': 'var(--gradient-crm)',
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-mesh': 'var(--gradient-mesh)',
      },
      boxShadow: {
        'inset-highlight': 'inset 0 1px 0 0 hsl(0 0% 100% / 0.05)',
        soft: '0 1px 2px 0 hsl(240 10% 0% / 0.06), 0 1px 0 0 hsl(0 0% 100% / 0.04) inset',
        elevated:
          '0 1px 0 0 hsl(0 0% 100% / 0.05) inset, 0 1px 3px 0 hsl(240 10% 0% / 0.08), 0 8px 20px -8px hsl(240 10% 0% / 0.16)',
        glow: '0 0 0 1px hsl(var(--brand) / 0.35), 0 8px 28px -6px hsl(var(--brand) / 0.45)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-in-0': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out-0': { from: { opacity: '1' }, to: { opacity: '0' } },
        'zoom-in-95': { from: { opacity: '0', transform: 'scale(.95)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'zoom-out-95': { from: { opacity: '1', transform: 'scale(1)' }, to: { opacity: '0', transform: 'scale(.95)' } },
        'slide-in-from-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'slide-out-to-left': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-100%)' } },
      },
      animation: { 'fade-in': 'fade-in 0.2s ease-out' },
    },
  },
  plugins: [animate],
} satisfies Config;
