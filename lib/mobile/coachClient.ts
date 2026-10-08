import type { CoachEvidence } from "@/lib/learn/coachEvidence";
import type { CoachReason } from "@/lib/learn/coachModel";

export type CoachText = { text: string; reason: CoachReason };

export function createCoachClient() {
  let worker: Worker | undefined;
  const pending = new Map<string, { resolve: (result: CoachText | null) => void; reject: (error: Error) => void; cleanup: () => void }>();
  const stop = (error: Error) => {
    worker?.terminate(); worker = undefined;
    for (const task of pending.values()) { task.cleanup(); task.reject(error); }
    pending.clear();
  };
  const dispose = () => stop(new DOMException("Coach cancelled.", "AbortError"));
  function request(evidence?: CoachEvidence, signal?: AbortSignal): Promise<CoachText | null> {
    if (signal?.aborted) return Promise.reject(new DOMException("Coach cancelled.", "AbortError"));
    worker ??= new Worker(new URL("../../workers/browser/coach.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: string; comment: CoachText | null; error?: string }>) => {
      const task = pending.get(event.data.id);
      if (!task) return;
      pending.delete(event.data.id); task.cleanup();
      if (event.data.error) task.reject(new Error(event.data.error)); else task.resolve(event.data.comment);
    };
    worker.onerror = () => {
      for (const task of pending.values()) { task.cleanup(); task.reject(new Error("Coach runtime unavailable.")); }
      pending.clear(); worker?.terminate(); worker = undefined;
    };
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const onAbort = () => dispose();
      const timeout = setTimeout(() => stop(new Error("Coach runtime timed out.")), 25_000);
      const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", onAbort); };
      pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", onAbort, { once: true });
      worker!.postMessage({ id, evidence });
    });
  }
  return { warm: () => request(), comment: (evidence: CoachEvidence, signal: AbortSignal) => request(evidence, signal), dispose };
}
