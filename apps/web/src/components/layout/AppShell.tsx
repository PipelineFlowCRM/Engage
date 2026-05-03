import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Filter, Mail, Send, ListChecks, ShieldOff, Key, Lock, Inbox, LogOut, Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/subscribers', label: 'Subscribers', icon: Users },
  { to: '/audiences', label: 'Audiences', icon: Filter },
  { to: '/templates', label: 'Templates', icon: Mail },
  { to: '/broadcasts', label: 'Broadcasts', icon: Send },
  { to: '/deliveries', label: 'Deliveries', icon: Inbox },
] as const;

const settingsNav = [
  { to: '/settings/subscription-groups', label: 'Subscription groups', icon: ListChecks },
  { to: '/settings/suppressions', label: 'Suppressions', icon: ShieldOff },
  { to: '/settings/api-tokens', label: 'API tokens', icon: Key },
  { to: '/settings/secrets', label: 'Secrets / SES', icon: Lock },
] as const;

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr]">
      <aside className="flex flex-col border-r border-border/60 bg-card/30">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="brand-chip h-7 w-7 rounded-md" />
          <div className="text-sm font-semibold tracking-tight">Engagement</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {nav.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
          <div className="my-3 border-t border-border/50" />
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Settings</div>
          {settingsNav.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
          <NavItem to="/settings/profile" label="Profile" icon={Settings} />
        </nav>
        <div className="space-y-2 border-t border-border/50 p-3">
          <div className="px-2 text-xs text-muted-foreground">Signed in as</div>
          <div className="px-2 text-sm font-medium">{user?.name}</div>
          <div className="px-2 text-xs text-muted-foreground truncate">{user?.email}</div>
          <Button onClick={handleLogout} variant="outline" size="sm" className="w-full">
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </div>
      </aside>
      <main className="overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({
  to, label, icon: Icon, end,
}: { to: string; label: string; icon: React.ComponentType<{ className?: string }>; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )
      }
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </NavLink>
  );
}
