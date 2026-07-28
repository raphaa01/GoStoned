import { ApiRequestError } from "./api";
import type { GameState } from "@/lib/game/types";

const HIDDEN_PAGE_DELAY_MS = 10_000;
const NETWORK_ERROR_DELAY_MS = 5_000;
const ACTIVE_CHAT_DELAY_MS = 800;
const FINISHED_CHAT_DELAY_MS = 3_000;

export function shouldPollGame(status: GameState["status"] | null): boolean {
  return status !== "finished";
}

export function nextChatPollDelay(
  status: GameState["status"] | null,
  error: unknown = null,
  pageHidden = false,
): number {
  return nextPollDelay(
    status === "finished" ? FINISHED_CHAT_DELAY_MS : ACTIVE_CHAT_DELAY_MS,
    error,
    pageHidden,
  );
}

export function createPollingRequestGuard() {
  let active = true;
  let controller: AbortController | null = null;

  return {
    start(): AbortSignal {
      controller?.abort();
      controller = new AbortController();
      return controller.signal;
    },
    isCurrent(signal: AbortSignal): boolean {
      return active && controller?.signal === signal && !signal.aborted;
    },
    cancel(): void {
      active = false;
      controller?.abort();
    },
  };
}

export function nextPollDelay(
  normalDelayMs: number,
  error: unknown = null,
  pageHidden = false,
): number {
  const visibilityDelay = pageHidden
    ? Math.max(normalDelayMs, HIDDEN_PAGE_DELAY_MS)
    : normalDelayMs;

  if (error instanceof ApiRequestError && error.retryAfterSeconds) {
    return Math.max(visibilityDelay, error.retryAfterSeconds * 1_000);
  }
  if (error) return Math.max(visibilityDelay, NETWORK_ERROR_DELAY_MS);
  return visibilityDelay;
}
