import {
  localBotThinkDelayMs as calculateThinkDelay,
  type LocalBotInput,
  type LocalBotMove,
} from "./localBot";

export function localBotThinkDelayMs(gameId: string, gameVersion: number): number {
  return calculateThinkDelay(gameId, gameVersion);
}

export function calculateLocalBotMove(
  input: LocalBotInput,
  signal: AbortSignal,
): Promise<LocalBotMove> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./localBot.worker.ts", import.meta.url), {
      name: "gostone-local-bot",
      type: "module",
    });
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => finish(new Error("Local bot timed out.")), 5_000);
    let settled = false;

    function finish(error?: Error, move?: LocalBotMove) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(move!);
    }
    function abort() {
      finish(new DOMException("Local bot cancelled.", "AbortError"));
    }

    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{
      requestId: string;
      ok: boolean;
      move?: LocalBotMove;
      error?: string;
    }>) => {
      if (event.data.requestId !== requestId) return;
      if (!event.data.ok || !event.data.move) {
        finish(new Error(event.data.error || "Local bot failed."));
        return;
      }
      finish(undefined, event.data.move);
    };
    worker.onerror = () => finish(new Error("Local bot worker crashed."));
    worker.postMessage({ requestId, input });
  });
}
