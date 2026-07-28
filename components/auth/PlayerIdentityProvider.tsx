"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { GuestIdentity } from "@/lib/auth/guestSession";
import { readApi } from "@/lib/client/api";
import { localizedApiError } from "@/lib/i18n/dictionary";
import { useAuth } from "./AuthProvider";

export function usePlayerIdentity() {
  const { dictionary } = useI18n();
  const {
    user,
    loading: authLoading,
    error: authError,
    refresh: refreshAuth,
  } = useAuth();
  const [guest, setGuest] = useState<GuestIdentity | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || authError || user || guest || guestError) return;
    const controller = new AbortController();
    fetch("/api/auth/guest", { method: "POST", signal: controller.signal })
      .then((response) => readApi<{ identity: GuestIdentity }>(response))
      .then((body) => setGuest(body.identity))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setGuestError(localizedApiError(
            dictionary,
            error,
            dictionary.apiErrors.guest_session_failed,
          ));
        }
      });
    return () => controller.abort();
  }, [authError, authLoading, dictionary, guest, guestError, user]);

  const retry = useCallback(() => {
    if (authError) {
      refreshAuth().catch(() => undefined);
      return;
    }
    setGuestError(null);
  }, [authError, refreshAuth]);

  return useMemo(() => {
    if (authLoading) {
      return { playerKey: null, playerName: null, loading: true, error: null, retry };
    }
    if (user) {
      return {
        playerKey: user.playerKey,
        playerName: user.displayName,
        loading: false,
        error: null,
        retry,
      };
    }
    if (authError) {
      return {
        playerKey: null,
        playerName: null,
        loading: false,
        error: authError,
        retry,
      };
    }
    return {
      playerKey: guest?.playerKey ?? null,
      playerName: guest?.displayName ?? null,
      loading: !guest && !guestError,
      error: guestError,
      retry,
    };
  }, [authError, authLoading, guest, guestError, retry, user]);
}
