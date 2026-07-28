import { ApiRequestError } from "./api";
import type { GameState } from "@/lib/game/types";

export type ReconnectReason = "network" | "offline" | "rate_limited" | "server";

export type GameConnectionState =
  | { kind: "connecting" }
  | { kind: "live"; lastSuccessAt: number }
  | {
      kind: "reconnecting";
      reason: ReconnectReason;
      observedAt: number | null;
      retryAt: number;
    }
  | { kind: "session_expired"; observedAt: number | null }
  | { kind: "unavailable" }
  | { kind: "final"; lastSuccessAt: number };

export const INITIAL_GAME_CONNECTION: GameConnectionState = { kind: "connecting" };

function observedAt(
  state: GameConnectionState,
  now: number,
): number | null {
  if (state.kind === "live") return now;
  if (state.kind === "reconnecting" || state.kind === "session_expired") {
    return state.observedAt;
  }
  return null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function connectionAfterSuccess(
  now: number,
  status: GameState["status"],
): GameConnectionState {
  return status === "finished"
    ? { kind: "final", lastSuccessAt: now }
    : { kind: "live", lastSuccessAt: now };
}

export function connectionAwaitingRefresh(
  state: GameConnectionState,
  reason: "network" | "offline",
  now: number,
): GameConnectionState {
  if (
    state.kind === "session_expired"
    || state.kind === "unavailable"
    || state.kind === "final"
  ) {
    return state;
  }
  return {
    kind: "reconnecting",
    reason,
    observedAt: observedAt(state, now),
    retryAt: now,
  };
}

export function connectionAfterFailure(
  state: GameConnectionState,
  error: unknown,
  now: number,
  retryDelayMs: number,
): GameConnectionState {
  if (error instanceof ApiRequestError && error.status === 401) {
    return {
      kind: "session_expired",
      observedAt: observedAt(state, now),
    };
  }
  if (
    state.kind === "session_expired"
    || state.kind === "unavailable"
    || state.kind === "final"
  ) {
    return state;
  }
  if (isAbortError(error)) return state;
  if (error instanceof ApiRequestError) {
    if (
      error.status >= 400
      && error.status < 500
      && error.status !== 408
      && error.status !== 429
    ) {
      return { kind: "unavailable" };
    }
  }

  const reason: ReconnectReason = error instanceof ApiRequestError
    ? error.status === 429
      ? "rate_limited"
      : error.status >= 500
        ? "server"
        : "network"
    : "network";
  return {
    kind: "reconnecting",
    reason,
    observedAt: observedAt(state, now),
    retryAt: now + Math.max(0, retryDelayMs),
  };
}

export function operationAffectsConnection(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return !isAbortError(error);
  return error.status === 401
    || error.status === 403
    || error.status === 404
    || error.status === 408
    || error.status === 429
    || error.status >= 500;
}

export function connectionAllowsGamePolling(
  state: GameConnectionState,
  status: GameState["status"] | null,
): boolean {
  return status !== "finished"
    && state.kind !== "session_expired"
    && state.kind !== "unavailable"
    && state.kind !== "final";
}

export function connectionAllowsMutations(state: GameConnectionState): boolean {
  return state.kind === "live";
}

export function connectionAllowsChat(state: GameConnectionState): boolean {
  return state.kind === "live" || state.kind === "final";
}

export function connectionClockObservedAt(state: GameConnectionState): number | null {
  return state.kind === "reconnecting" || state.kind === "session_expired"
    ? state.observedAt
    : null;
}

export function isTerminalConnection(state: GameConnectionState): boolean {
  return state.kind === "session_expired" || state.kind === "unavailable";
}
