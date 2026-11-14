"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invalidateRouteData } from "@/lib/client/routeCache";
import { readApi } from "@/lib/client/api";
import { withDeadline } from "@/lib/mobile/withDeadline";
import { useI18n } from "@/components/i18n/I18nProvider";
import { localizedAuthError } from "@/lib/i18n/dictionary";
import type { AuthUser } from "@/lib/auth/types";
import { AccountEmailGate } from "./AccountEmailGate";
import type { CurrentRatingIdentity } from "@/lib/stats/statsService";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  rating: CurrentRatingIdentity | null;
  ratingLoading: boolean;
  refresh: (options?: { silent?: boolean }) => Promise<AuthUser | null | undefined>;
  refreshRating: () => Promise<void>;
  logout: () => Promise<void>;
  clearSession: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { dictionary } = useI18n();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [rating, setRating] = useState<CurrentRatingIdentity | null>(null);
  const [ratingLoading, setRatingLoading] = useState(false);
  const ratingRequestGeneration = useRef(0);
  const cacheOwner = useRef<string | null>(null);
  const sessionRequestGeneration = useRef(0);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const generation = ++sessionRequestGeneration.current;
    if (!options?.silent) setLoading(true);
    const controller = new AbortController();
    try {
      const request = fetch("/api/auth/session", {
        cache: "no-store",
        signal: controller.signal,
      }).then(readApi<{ user: AuthUser | null }>);
      const body = await withDeadline(request, 12_000, "Session lookup timed out.");
      if (sessionRequestGeneration.current !== generation) return;
      const nextOwner = body.user?.playerKey ?? null;
      if (cacheOwner.current !== nextOwner) invalidateRouteData();
      cacheOwner.current = nextOwner;
      setUser(body.user ?? null);
      setErrorCode(null);
      return body.user ?? null;
    } catch (requestError) {
      if (sessionRequestGeneration.current !== generation) return;
      // A transient background failure must not hide an authenticated screen
      // or unmount an ongoing game. A successful anonymous reply clears it.
      if (!options?.silent || !cacheOwner.current) setErrorCode("session_failed");
      throw requestError;
    } finally {
      controller.abort();
      if (sessionRequestGeneration.current === generation) setLoading(false);
    }
  }, []);

  const refreshRating = useCallback(async (options?: { invalidate?: boolean }) => {
    const playerKey = user?.emailRequired ? undefined : user?.playerKey;
    const generation = ratingRequestGeneration.current + 1;
    ratingRequestGeneration.current = generation;
    if (!playerKey) {
      setRating(null);
      setRatingLoading(false);
      return;
    }
    if (options?.invalidate !== false) invalidateRouteData();
    setRatingLoading(true);
    try {
      const response = await fetch("/api/profile/rating", { cache: "no-store" });
      const body = await readApi<{ rating: CurrentRatingIdentity | null }>(response);
      if (ratingRequestGeneration.current === generation) {
        setRating(body.rating ?? null);
      }
    } finally {
      if (ratingRequestGeneration.current === generation) {
        setRatingLoading(false);
      }
    }
  }, [user?.playerKey, user?.emailRequired]);

  // Clear local identity only after the server confirms logout or deletion.
  const clearSession = useCallback(() => {
    invalidateRouteData();
    sessionRequestGeneration.current += 1;
    cacheOwner.current = null;
    ratingRequestGeneration.current += 1;
    setUser(null);
    setLoading(false);
    setRating(null);
    setRatingLoading(false);
    setErrorCode(null);
  }, []);

  const logout = useCallback(async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    const body = (await response.json()) as { ok: boolean; code?: string };
    if (!response.ok || !body.ok) {
      const logoutError = new Error(localizedAuthError(dictionary, body.code, "logout_failed"));
      setErrorCode(body.code ?? "logout_failed");
      throw logoutError;
    }
    clearSession();
  }, [dictionary, clearSession]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      refresh().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  useEffect(() => {
    const onMobileAuth = () => { void refresh().catch(() => undefined); };
    window.addEventListener("gostone:auth-change", onMobileAuth);
    return () => window.removeEventListener("gostone:auth-change", onMobileAuth);
  }, [refresh]);

  useEffect(() => {
    if (loading) return;
    const timeout = window.setTimeout(() => {
      refreshRating({ invalidate: false }).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loading, refreshRating]);

  const error = errorCode ? localizedAuthError(dictionary, errorCode, "session_failed") : null;
  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      rating,
      ratingLoading,
      refresh,
      refreshRating,
      logout,
      clearSession,
    }),
    [user, loading, error, rating, ratingLoading, refresh, refreshRating, logout, clearSession],
  );

  return <AuthContext.Provider value={value}>{user?.emailRequired ? <AccountEmailGate /> : children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
