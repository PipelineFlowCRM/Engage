import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  theme: 'system' | 'light' | 'dark';
}

// 'unknown' = haven't checked yet (initial mount).
// 'unauthenticated' = checked, no session (or 401 response).
// 'authenticated' = user object present.
// 'error' = transient network / 5xx — UI should show a banner instead of
// redirecting to login. Persists across retries until we get a definitive
// answer from /auth/me.
type AuthState = 'unknown' | 'unauthenticated' | 'authenticated' | 'error';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  // True when we've hit a transient failure (5xx, network) and the
  // RequireAuth gate should NOT redirect. UI shows a banner.
  errorState: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<AuthState>('unknown');

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: User }>('/auth/me');
      setUser(user);
      setState('authenticated');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        setState('unauthenticated');
        return;
      }
      // Transient network/5xx — don't drop the user to login. Surface as
      // an error banner instead. The next refresh attempt resets state.
      setState('error');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.post<{ user: User }>('/auth/login', { email, password });
    setUser(user);
    setState('authenticated');
  }, []);

  const register = useCallback(async (email: string, name: string, password: string) => {
    const { user } = await api.post<{ user: User }>('/auth/register', { email, name, password });
    setUser(user);
    setState('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
    setState('unauthenticated');
    // Drop every cached query so the next operator on a shared device
    // doesn't see the previous one's subscriber/audience/delivery data.
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading: state === 'unknown',
      errorState: state === 'error',
      refresh, login, register, logout,
    }),
    [user, state, refresh, login, register, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}
