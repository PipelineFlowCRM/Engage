import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const variants = {
  default: 'bg-secondary text-secondary-foreground',
  brand: 'bg-brand/15 text-brand border border-brand/40',
  success: 'bg-success/15 text-success-foreground border border-success/40',
  warning: 'bg-warning/15 text-warning-foreground border border-warning/40',
  destructive: 'bg-destructive/15 text-destructive border border-destructive/40',
  outline: 'border border-border text-foreground',
} as const;

interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variants;
}
export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
