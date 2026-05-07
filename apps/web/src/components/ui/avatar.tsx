import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Avatar = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  ),
);
Avatar.displayName = 'Avatar';

export const AvatarFallback = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { color?: string }
>(({ className, color, style, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex h-full w-full items-center justify-center rounded-full text-xs font-medium text-white',
      className,
    )}
    style={{ backgroundImage: color ?? 'var(--gradient-brand)', ...style }}
    {...props}
  />
));
AvatarFallback.displayName = 'AvatarFallback';
