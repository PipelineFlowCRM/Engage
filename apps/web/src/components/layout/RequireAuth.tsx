import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, errorState, refresh } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  }
  // Transient backend trouble — don't bounce the user to login. A 5xx /
  // network blip mid-refresh shouldn't masquerade as a logout.
  if (errorState && !user) {
    return (
      <div className="grid min-h-screen place-items-center p-4 text-center">
        <div>
          <p className="text-sm text-destructive">Couldn't reach the server.</p>
          <p className="mt-1 text-xs text-muted-foreground">Check your connection or wait a moment.</p>
          <Button className="mt-4" variant="outline" onClick={() => void refresh()}>Retry</Button>
        </div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
