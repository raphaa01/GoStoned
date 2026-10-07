"use client";

import { useEffect, useState } from "react";
import { cachedRouteData, readRouteData } from "@/lib/client/routeCache";

export function useRouteResource<T>(key: string | null, load: () => Promise<T>, ttl = 60_000) {
  const [state, setState] = useState<{ key: string | null; load: () => Promise<T>; data?: T; error?: unknown; loaded: boolean }>(() => ({
    key, load, data: key ? cachedRouteData<T>(key) : undefined, loaded: false,
  }));
  useEffect(() => {
    if (!key) return;
    let active = true;
    void readRouteData(key, load, ttl).then(
      (data) => { if (active) setState({ key, load, data, loaded: true }); },
      (error: unknown) => { if (active) setState({ key, load, error, loaded: true }); },
    );
    return () => { active = false; };
  }, [key, load, ttl]);
  const current = state.key === key && state.load === load ? state : { key, data: key ? cachedRouteData<T>(key) : undefined, error: undefined, loaded: false };
  return { data: current.data, error: current.error, loaded: current.loaded || current.data !== undefined };
}
