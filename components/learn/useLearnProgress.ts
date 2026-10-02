"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  emptyLearnProgress,
  mergeLearnProgress,
  parseLearnProgress,
  type LearnProgress,
} from "@/lib/learn/progress";

const STORAGE_KEY = "gostone.learn.path.v1";

function readLocal(): LearnProgress {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseLearnProgress(JSON.parse(raw)) : emptyLearnProgress();
  } catch {
    return emptyLearnProgress();
  }
}

function writeLocal(progress: LearnProgress) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  window.dispatchEvent(new Event("gostone:learn-progress"));
}

export function useLearnProgress() {
  const { user } = useAuth();
  const [progress, setProgress] = useState<LearnProgress>(() => emptyLearnProgress());
  const [loaded, setLoaded] = useState(false);
  const progressRef = useRef(progress);
  const userIdRef = useRef<string | null>(null);
  const remoteQueue = useRef<Promise<void>>(Promise.resolve());

  const saveRemote = useCallback(async (next: LearnProgress) => {
    if (!userIdRef.current) return;
    remoteQueue.current = remoteQueue.current.then(async () => {
      if (!userIdRef.current) return;
      try {
        await fetch("/api/learn/progress", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ progress: next }),
        });
      } catch {
        // Local progress is authoritative until the account can sync again.
      }
    });
    await remoteQueue.current;
  }, []);

  const commit = useCallback((update: LearnProgress | ((current: LearnProgress) => LearnProgress)) => {
    const next = typeof update === "function" ? update(progressRef.current) : update;
    progressRef.current = next;
    setProgress(next);
    writeLocal(next);
    void saveRemote(next);
    return next;
  }, [saveRemote]);

  useEffect(() => {
    const local = readLocal();
    const frame = window.requestAnimationFrame(() => {
      progressRef.current = local;
      setProgress(local);
      setLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
    if (!user?.id || !loaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/learn/progress", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { progress?: unknown };
        if (cancelled) return;
        const merged = mergeLearnProgress(progressRef.current, parseLearnProgress(body.progress));
        progressRef.current = merged;
        setProgress(merged);
        writeLocal(merged);
        await saveRemote(merged);
      } catch {
        // The local copy remains usable offline and will merge on the next visit.
      }
    })();
    return () => { cancelled = true; };
  }, [loaded, saveRemote, user?.id]);

  return { progress, loaded, commit };
}
