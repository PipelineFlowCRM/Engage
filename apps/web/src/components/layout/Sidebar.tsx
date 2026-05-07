import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Activity, Cog, Filter, GitBranch, Inbox, LayoutDashboard, Mail, Send, Users, X,
} from 'lucide-react';
import { Wordmark } from './Wordmark';
import { cn } from '@/lib/utils';

const PRIMARY = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/events', label: 'Events', icon: Activity },
  { to: '/subscribers', label: 'Subscribers', icon: Users },
  { to: '/audiences', label: 'Audiences', icon: Filter },
  { to: '/templates', label: 'Templates', icon: Mail },
  { to: '/broadcasts', label: 'Broadcasts', icon: Send },
  { to: '/journeys', label: 'Journeys', icon: GitBranch },
  { to: '/deliveries', label: 'Deliveries', icon: Inbox },
] as const;

// Settings is a single entry; the inner SettingsLayout has its own nav rail
// covering Profile, Subscription groups, Suppressions, API tokens, and SES.
const SECONDARY = [
  { to: '/settings', label: 'Settings', icon: Cog },
] as const;

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 mesh opacity-50" />
      <div className="relative px-2 pb-5">
        <Wordmark iconSize="sm" />
      </div>
      <nav className="relative flex-1 space-y-0.5 overflow-y-auto pr-1">
        {PRIMARY.map((item) => (
          <NavItem key={item.to} {...item} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="relative mt-2 space-y-0.5 border-t border-border/70 pt-2">
        {SECONDARY.map((item) => (
          <NavItem key={item.to} {...item} onNavigate={onNavigate} />
        ))}
      </div>
    </>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          isActive &&
            'bg-accent text-foreground shadow-inset-highlight before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-gradient-brand',
        )
      }
    >
      <Icon className="h-4 w-4" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

export function Sidebar() {
  return (
    <aside className="relative hidden h-screen w-60 shrink-0 flex-col border-r border-border/70 bg-card/40 px-3 py-4 backdrop-blur md:flex">
      <SidebarContent />
    </aside>
  );
}

export function MobileSidebar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const location = useLocation();
  // Close drawer on route change so navigating dismisses it.
  useEffect(() => {
    if (open) onOpenChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:hidden" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex h-full w-64 max-w-[80vw] flex-col border-r border-border/80 bg-card px-3 py-4 shadow-elevated outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left md:hidden">
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label="Close menu"
            className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
          <SidebarContent onNavigate={() => onOpenChange(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
