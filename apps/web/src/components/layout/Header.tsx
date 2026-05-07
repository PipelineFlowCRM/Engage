import { useNavigate } from 'react-router-dom';
import { Check, LogOut, Menu, Monitor, Moon, Search, Sun, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { cn, initials } from '@/lib/utils';

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 bg-background/70 px-3 backdrop-blur-xl sm:gap-3 sm:px-4 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open menu"
        onClick={onMenuClick}
        className="md:hidden"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Placeholder search input — visual only for now; wire to a command
          palette in a follow-up. */}
      <button
        type="button"
        aria-label="Search"
        className="group flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/80 bg-card/60 px-3 text-[13px] text-muted-foreground shadow-soft transition-all hover:border-border hover:bg-accent hover:text-foreground sm:max-w-md"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          <span className="sm:hidden">Search…</span>
          <span className="hidden sm:inline">Search subscribers, audiences, broadcasts…</span>
        </span>
        <kbd className="ml-auto hidden items-center gap-0.5 rounded border border-border/80 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium tabular text-muted-foreground sm:inline-flex">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <ThemeMenu />
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Account menu"
                className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{initials(user.name)}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="font-medium">{user.name}</div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate('/settings/profile')}>
                <UserIcon className="h-4 w-4" /> Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                <LogOut className="h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  );
}

function ThemeMenu() {
  const { theme, resolved, setTheme } = useTheme();
  const Icon = resolved === 'dark' ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme">
          <Icon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <ThemeChoice label="Light" value="light" current={theme} onChoose={setTheme} icon={Sun} />
        <ThemeChoice label="Dark" value="dark" current={theme} onChoose={setTheme} icon={Moon} />
        <ThemeChoice label="System" value="system" current={theme} onChoose={setTheme} icon={Monitor} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeChoice({
  label, value, current, onChoose, icon: Icon,
}: {
  label: string;
  value: 'light' | 'dark' | 'system';
  current: 'light' | 'dark' | 'system';
  onChoose: (v: 'light' | 'dark' | 'system') => void;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const active = current === value;
  return (
    <DropdownMenuItem onSelect={() => onChoose(value)}>
      <Icon className="h-4 w-4" />
      <span className="flex-1">{label}</span>
      <Check className={cn('h-3.5 w-3.5', active ? 'opacity-100' : 'opacity-0')} />
    </DropdownMenuItem>
  );
}
