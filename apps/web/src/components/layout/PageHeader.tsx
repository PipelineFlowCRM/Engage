import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'relative flex flex-wrap items-center justify-between gap-4 border-b border-border/60 px-6 py-5',
        // Hairline brand gradient at the top of every page header — gives
        // the app a quiet but consistent identity touch.
        'before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-brand before:opacity-60',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
