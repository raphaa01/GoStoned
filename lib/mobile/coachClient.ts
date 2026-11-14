import CoachWorker from "../../workers/browser/coach.worker?worker&inline";
import { GOSTONE_BOT_MODEL } from "@/lib/bot/modelV1";
import type { CoachEvidence } from "@/lib/learn/coachEvidence";
import { COACH_MODEL, type CoachReason } from "@/lib/learn/coachModel";
import type { CoachRuntimeAssets } from "../../workers/browser/coach.worker";

export type CoachText = { text: string; reason: CoachReason };

async function bundledAsset(path: string, signal: AbortSignal, expectedHash?: string) {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`Coach asset unavailable: ${path}`);
  const bytes = await response.arrayBuffer();
  if (expectedHash) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== expectedHash) throw new Error(`Coach asset identity mismatch: ${path}`);
  }
  return bytes;
}

export function createCoachClient() {
  let worker: Worker | undefined;
  let startup: Promise<CoachText | null> | undefined;
  let assetLoad: AbortController | undefined;
  const pending = new Map<string, { resolve: (result: CoachText | null) => void; reject: (error: Error) => void; cleanup: () => void }>();
  const stop = (error: Error) => {
    const controller = assetLoad;
    assetLoad = undefined;
    controller?.abort();
    worker?.terminate();
    worker = undefined;
    startup = undefined;
    for (const task of pending.values()) {
      task.cleanup();
      task.reject(error);
    }
    pending.clear();
  };
  const dispose = () => stop(new DOMException("Coach cancelled.", "AbortError"));

  function send(target: Worker, payload: { assets: CoachRuntimeAssets } | { evidence: CoachEvidence }, signal?: AbortSignal, transfer: Transferable[] = []): Promise<CoachText | null> {
    signal?.throwIfAborted();
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => stop(new Error("Coach runtime timed out.")), 25_000);
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", dispose);
      };
      pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", dispose, { once: true });
      try {
        target.postMessage({ id, ...payload }, transfer);
      } catch (error) {
        stop(error instanceof Error ? error : new Error("Coach worker rejected the request."));
      }
    });
  }

  async function warm(signal: AbortSignal): Promise<CoachText | null> {
    signal.throwIfAborted();
    if (startup) return startup;
    const controller = new AbortController();
    assetLoad = controller;
    signal.addEventListener("abort", dispose, { once: true });
    startup = (async () => {
      try {
        const [model, vocabulary, schema, manifest, wasm] = await Promise.all([
          bundledAsset(`${COACH_MODEL.baseUrl}coach.onnx`, controller.signal, COACH_MODEL.files["coach.onnx"]),
          bundledAsset(`${COACH_MODEL.baseUrl}tokenizer.json`, controller.signal, COACH_MODEL.files["tokenizer.json"]),
          bundledAsset(`${COACH_MODEL.baseUrl}schema.json`, controller.signal, COACH_MODEL.files["schema.json"]),
          bundledAsset(`${COACH_MODEL.baseUrl}manifest.json`, controller.signal, COACH_MODEL.files["manifest.json"]),
          bundledAsset(`${GOSTONE_BOT_MODEL.runtimeBaseUrl}ort-wasm-simd-threaded.wasm`, controller.signal),
        ]);
        controller.signal.throwIfAborted();
        // WKWebView serves the app from capacitor://. The document loads the
        // assets and a self-contained blob worker receives their bytes.
        const target = new CoachWorker();
        worker = target;
        target.onmessage = (event: MessageEvent<{ id: string; comment: CoachText | null; error?: string }>) => {
          if (worker !== target) return;
          const task = pending.get(event.data.id);
          if (!task) return;
          if (event.data.error) {
            stop(new Error(event.data.error));
            return;
          }
          pending.delete(event.data.id);
          task.cleanup();
          task.resolve(event.data.comment);
        };
        target.onerror = (event) => {
          if (worker === target) stop(new Error(event.message || "Coach runtime unavailable."));
        };
        return await send(target, { assets: { model, vocabulary, schema, manifest, wasm } }, undefined, [model, vocabulary, schema, manifest, wasm]);
      } catch (error) {
        if (assetLoad === controller) dispose();
        throw error;
      } finally {
        if (assetLoad === controller) assetLoad = undefined;
        signal.removeEventListener("abort", dispose);
      }
    })();
    return startup;
  }

  return {
    warm,
    async comment(evidence: CoachEvidence, signal: AbortSignal) {
      await warm(signal);
      signal.throwIfAborted();
      if (!worker) throw new DOMException("Coach cancelled.", "AbortError");
      return send(worker, { evidence }, signal);
    },
    dispose,
  };
}
