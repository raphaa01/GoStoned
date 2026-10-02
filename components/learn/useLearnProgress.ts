"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { emptyLearnProgress, mergeLearnProgress, parseLearnProgress, type LearnProgress } from "@/lib/learn/progress";

function storageKey(userId: string | null) { return `gostone.learn.path.v1:${userId ?? "guest"}`; }
function readLocal(key: string): LearnProgress {
  try { return parseLearnProgress(JSON.parse(window.localStorage.getItem(key) ?? "null")); }
  catch { return emptyLearnProgress(); }
}
function writeLocal(key: string, progress: LearnProgress) {
  try { window.localStorage.setItem(key, JSON.stringify(progress)); }
  catch { /* Account synchronization remains available if browser storage is disabled. */ }
  window.dispatchEvent(new Event("gostone:learn-progress"));
}

export function useLearnProgress() {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const [progress, setProgress] = useState<LearnProgress>(() => emptyLearnProgress());
  const [loadedUserId, setLoadedUserId] = useState<string | null | undefined>(undefined);
  const progressRef = useRef(progress);
  const identity = useRef<{ key: string; userId: string | null } | null>(null);
  const remoteQueue = useRef<Promise<void>>(Promise.resolve());

  const saveRemote = useCallback((next: LearnProgress) => {
    const owner = identity.current;
    if (!owner?.userId) return;
    remoteQueue.current = remoteQueue.current.then(async () => {
      if (identity.current !== owner) return;
      try {
        await fetch("/api/learn/progress", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ progress: next }) });
      } catch { /* The local copy retries on the next visit. */ }
    });
  }, []);

  const commit = useCallback((update: LearnProgress | ((current: LearnProgress) => LearnProgress)) => {
    if (!identity.current || identity.current.userId !== userId) return progressRef.current;
    const next = typeof update === "function" ? update(progressRef.current) : update;
    if (next === progressRef.current) return next;
    progressRef.current = next;
    setProgress(next);
    writeLocal(identity.current.key, next);
    saveRemote(next);
    return next;
  }, [saveRemote, userId]);

  useEffect(() => {
    if (loading) return;
    const owner = { key: storageKey(userId), userId };
    identity.current = owner;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const local = readLocal(owner.key);
      progressRef.current = local;
      setProgress(local);
      setLoadedUserId(userId);
      if (!userId) return;
      try {
        const response = await fetch("/api/learn/progress", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const body = await response.json() as { progress?: unknown };
        if (cancelled) return;
        const merged = body.progress ? mergeLearnProgress(progressRef.current, parseLearnProgress(body.progress)) : progressRef.current;
        progressRef.current = merged;
        setProgress(merged);
        writeLocal(owner.key, merged);
        saveRemote(merged);
      } catch { /* Continue with the account-specific local progress offline. */ }
    })();
    return () => { cancelled = true; identity.current = null; };
  }, [loading, saveRemote, userId]);

  return { progress, loaded: loadedUserId === userId && !loading, commit };
}
