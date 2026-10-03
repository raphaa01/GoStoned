"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { readApi } from "@/lib/client/api";
import { parseBoardDesignPreference, type BoardDesignId, type BoardDesignPreference } from "@/lib/boardDesign";

type DesignContext = BoardDesignPreference & {
  ready: boolean;
  loadFailed: boolean;
  reload: () => Promise<void>;
  select: (design: BoardDesignId) => Promise<void>;
};
const BoardDesignContext = createContext<DesignContext>({
  design: "default", wins: 0, ready: false, loadFailed: false,
  reload: async () => undefined, select: async () => undefined,
});

export function BoardDesignProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const userId = user?.id;
  const revision = useRef(0);
  const [saved, setSaved] = useState<{ userId: string; preference: BoardDesignPreference } | null>(null);
  const [failedUser, setFailedUser] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!userId || loading) return;
    const requestRevision = ++revision.current;
    try {
      const response = await fetch("/api/profile/board-design", { cache: "no-store" });
      const body = await readApi<{ preference: unknown }>(response);
      const preference = parseBoardDesignPreference(body.preference);
      if (revision.current !== requestRevision) return;
      setSaved({ userId, preference });
      setFailedUser(null);
    } catch {
      if (revision.current === requestRevision) setFailedUser(userId);
    }
  }, [userId, loading]);

  useEffect(() => {
    const requests = revision;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => { window.clearTimeout(timer); requests.current++; };
  }, [reload]);

  const select = useCallback(async (design: BoardDesignId) => {
    if (!userId) throw new Error("Sign in to choose a board design.");
    const requestRevision = ++revision.current;
    const response = await fetch("/api/profile/board-design", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design }),
    });
    const body = await readApi<{ preference: unknown }>(response);
    const preference = parseBoardDesignPreference(body.preference);
    if (revision.current === requestRevision) {
      setSaved({ userId, preference });
      setFailedUser(null);
    }
  }, [userId]);

  const preference = userId && saved?.userId === userId ? saved.preference : null;
  const value = useMemo<DesignContext>(() => ({
    design: preference?.design ?? "default", wins: preference?.wins ?? 0,
    ready: preference !== null, loadFailed: !!userId && failedUser === userId, reload, select,
  }), [preference, failedUser, userId, reload, select]);
  return <BoardDesignContext.Provider value={value}>{children}</BoardDesignContext.Provider>;
}

export function useBoardDesign() { return useContext(BoardDesignContext); }
