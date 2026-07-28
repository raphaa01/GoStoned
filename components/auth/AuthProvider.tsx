"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { localizedAuthError } from "@/lib/i18n/dictionary";
import type { AuthUser } from "@/lib/auth/types";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { dictionary } = useI18n();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const body = (await response.json()) as {
        ok: boolean;
        code?: string;
        user?: AuthUser | null;
      };
      if (!response.ok || !body.ok) {
        throw new Error(localizedAuthError(dictionary, body.code, "session_failed"));
      }
      setUser(body.user ?? null);
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : dictionary.auth.errors.session_failed,
      );
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [dictionary]);

  const logout = useCallback(async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    const body = (await response.json()) as { ok: boolean; code?: string };
    if (!response.ok || !body.ok) {
      const logoutError = new Error(localizedAuthError(dictionary, body.code, "logout_failed"));
      setError(logoutError.message);
      throw logoutError;
    }
    setUser(null);
    setError(null);
  }, [dictionary]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      refresh().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const value = useMemo(
    () => ({ user, loading, error, refresh, logout }),
    [user, loading, error, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
