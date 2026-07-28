import { ApiRequestError } from "./api";

const HIDDEN_PAGE_DELAY_MS = 10_000;
const NETWORK_ERROR_DELAY_MS = 5_000;

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
