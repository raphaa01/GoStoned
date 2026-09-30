"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { readApi } from "@/lib/client/api";
import {
  DEFAULT_BOARD_PLACEMENT,
  type BoardPlacementPreference,
} from "@/lib/boardPlacement";

type BoardPlacementContextValue = {
  preference: BoardPlacementPreference;
  setPreference: (preference: BoardPlacementPreference) => void;
};

const BoardPlacementContext = createContext<BoardPlacementContextValue>({
  preference: DEFAULT_BOARD_PLACEMENT,
  setPreference: () => undefined,
});

export function BoardPlacementProvider({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const playerKey = user?.playerKey ?? null;
  const [savedPreference, setSavedPreference] = useState<{
    playerKey: string;
    value: BoardPlacementPreference;
  } | null>(null);

  useEffect(() => {
    if (loading || !playerKey) return;
    const controller = new AbortController();
    void fetch("/api/profile/preferences", { cache: "no-store", signal: controller.signal })
      .then((response) => readApi<{ preferences: { boardPlacement: BoardPlacementPreference } }>(response))
      .then((body) => setSavedPreference({ playerKey, value: body.preferences.boardPlacement }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [loading, playerKey]);

  const preference = playerKey && savedPreference?.playerKey === playerKey
    ? savedPreference.value
    : DEFAULT_BOARD_PLACEMENT;
  const setPreference = useCallback((value: BoardPlacementPreference) => {
    if (playerKey) setSavedPreference({ playerKey, value });
  }, [playerKey]);

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);
  return <BoardPlacementContext.Provider value={value}>{children}</BoardPlacementContext.Provider>;
}

export function useBoardPlacement() {
  return useContext(BoardPlacementContext);
}
