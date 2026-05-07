import { cn } from '@/lib/utils';

// PipelineFlow Engagement family wordmark.
//
// "Pipeline" — slate-900, weight 600
// "Flow"     — CRM gradient (blue→teal), weight 800
// "Engagement" — Engagement gradient (indigo→fuchsia→pink), weight 600
//
// Renders icon + two-line lockup. The "compact" variant drops the
// Engagement suffix (icon + "PipelineFlow" only) for tight horizontal
// chrome like header bars.
export function Wordmark({
  compact = false,
  iconSize = 'md',
  className,
}: {
  compact?: boolean;
  iconSize?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizes = { sm: 'h-7 w-7', md: 'h-9 w-9', lg: 'h-12 w-12' };
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <img
        src="/logo-icon.svg"
        alt=""
        className={cn(sizes[iconSize], 'rounded-lg shadow-glow')}
      />
      <div className="leading-none">
        <div className="text-[15px] tracking-tight">
          <span className="font-medium text-foreground">Pipeline</span>
          <span className="font-extrabold text-gradient-crm">Flow</span>
        </div>
        {compact ? null : (
          <div className="mt-1 text-[12px] font-semibold tracking-tight text-gradient">
            Engagement
          </div>
        )}
      </div>
    </div>
  );
}
