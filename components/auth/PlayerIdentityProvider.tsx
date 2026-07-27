"use client";

import { useEffect, useMemo, useState } from "react";
import { getOrCreateGuestPlayerKey, shortPlayerName } from "@/lib/client/guestIdentity";
import { useAuth } from "./AuthProvider";

export function usePlayerIdentity() {
  const { user, loading: authLoading } = useAuth();
  const [guestKey, setGuestKey] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setGuestKey(getOrCreateGuestPlayerKey());
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  return useMemo(() => {
    if (authLoading) return { playerKey: null, playerName: null, loading: true };
    if (user) {
      return { playerKey: user.playerKey, playerName: user.displayName, loading: false };
    }
    return {
      playerKey: guestKey,
      playerName: guestKey ? shortPlayerName(guestKey) : null,
      loading: guestKey === null,
    };
  }, [authLoading, guestKey, user]);
}
