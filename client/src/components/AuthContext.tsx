import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as authApi from "../api/auth";
import { setUnauthorizedHandler } from "../api/request";
import type { User } from "../types";

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<User | null>;
  setUser: (user: User | null) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  const refresh = useCallback(async (): Promise<User | null> => {
    try {
      const res = await authApi.me();
      setUser(res.user);
      return res.user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await refresh();
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler((fromPath) => {
      setUser(null);
      const from = fromPath ?? location.pathname + location.search;
      navigate("/login", { replace: true, state: { from } });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, location.pathname, location.search]);

  const value = useMemo(() => ({ user, loading, refresh, setUser }), [user, loading, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
