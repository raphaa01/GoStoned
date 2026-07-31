import { ApiRequestError } from "./api";

export type MatchmakingReconnectReason =
  | "network"
  | "offline"
  | "rate_limited"
  | "server";

export type MatchmakingConnectionState =
  | { kind: "checking" }
  | { kind: "live"; lastSuccessAt: number }
  | {
      kind: "reconnecting";
      reason: MatchmakingReconnectReason;
      retryAt: number;
    }
  | { kind: "session_expired" }
  | { kind: "identity_changed" }
  | { kind: "unavailable" };

export const INITIAL_MATCHMAKING_CONNECTION: MatchmakingConnectionState = {
  kind: "checking",
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function matchmakingConnectionAfterSuccess(
  now: number,
): MatchmakingConnectionState {
  return { kind: "live", lastSuccessAt: now };
}

export function matchmakingConnectionAfterFailure(
  state: MatchmakingConnectionState,
  error: unknown,
  now: number,
  retryDelayMs: number,
): MatchmakingConnectionState {
  if (error instanceof ApiRequestError && error.code === "identity_changed") {
    return { kind: "identity_changed" };
  }
  if (error instanceof ApiRequestError && error.status === 401) {
    return { kind: "session_expired" };
  }
  if (
    state.kind === "session_expired"
    || state.kind === "identity_changed"
    || state.kind === "unavailable"
    || isAbortError(error)
  ) {
    return state;
  }
  if (
    error instanceof ApiRequestError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 429
  ) {
    return { kind: "unavailable" };
  }
  return {
    kind: "reconnecting",
    reason: error instanceof ApiRequestError && error.status === 429
      ? "rate_limited"
      : !navigatorOnline()
        ? "offline"
        : error instanceof ApiRequestError && error.status >= 500
          ? "server"
          : "network",
    retryAt: now + Math.max(0, retryDelayMs),
  };
}

function navigatorOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

export function matchmakingConnectionAllowsSync(
  state: MatchmakingConnectionState,
): boolean {
  return state.kind !== "session_expired"
    && state.kind !== "identity_changed"
    && state.kind !== "unavailable";
}

export function matchmakingConnectionAllowsActions(
  state: MatchmakingConnectionState,
): boolean {
  return state.kind === "live";
}

export function isTerminalMatchmakingConnection(
  state: MatchmakingConnectionState,
): boolean {
  return state.kind === "session_expired"
    || state.kind === "identity_changed"
    || state.kind === "unavailable";
}

export function matchmakingOperationNeedsReconciliation(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (!(error instanceof ApiRequestError)) return true;
  return error.status === 401
    || error.status === 403
    || error.status === 404
    || error.status === 408
    || error.status === 409
    || error.status === 429
    || error.status >= 500;
}
