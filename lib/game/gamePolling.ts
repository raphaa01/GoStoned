import type { GamePollResponse, GameState } from "./types";

export const FULL_GAME_REFRESH_INTERVAL_MS = 30_000;
export const MAX_PERSISTED_GAME_VERSION = 2_147_483_647;

export type KnownGameVersionQuery =
  | { kind: "full" }
  | { kind: "version"; knownVersion: number }
  | { kind: "invalid" };

export function parseKnownGameVersion(search: string): KnownGameVersionQuery {
  if (search === "") return { kind: "full" };
  const match = /^\?knownVersion=(0|[1-9]\d*)$/.exec(search);
  if (!match) return { kind: "invalid" };
  const knownVersion = Number(match[1]);
  return Number.isSafeInteger(knownVersion)
      && knownVersion <= MAX_PERSISTED_GAME_VERSION
    ? { kind: "version", knownVersion }
    : { kind: "invalid" };
}

export function gamePollUrl(
  gameId: string,
  knownVersion: number,
  lastFullResponseAt: number,
  now = Date.now(),
): string {
  const path = `/api/games/${encodeURIComponent(gameId)}`;
  // Game versions cover persisted gameplay, while names and integrity checks
  // still live in the full representation. Revalidate them periodically.
  if (
    !Number.isSafeInteger(knownVersion)
    || knownVersion < 0
    || knownVersion > MAX_PERSISTED_GAME_VERSION
    || lastFullResponseAt <= 0
    || now - lastFullResponseAt >= FULL_GAME_REFRESH_INTERVAL_MS
  ) {
    return path;
  }
  return `${path}?knownVersion=${knownVersion}`;
}

export function gameStateFromPoll(
  current: GameState | null,
  response: GamePollResponse,
  clientReceivedAt = Date.now(),
): GameState | null {
  const candidate = "game" in response
    ? response.game
    : current
      && response.gameId === current.id
      && response.version === current.version
      ? { ...current, clock: response.clock }
      : null;
  if (!candidate) return null;

  const candidateServerNow = Date.parse(candidate.clock.serverNow);
  if (!Number.isFinite(candidateServerNow)) return null;
  if (current) {
    if (candidate.id !== current.id || candidate.version < current.version) return null;
    if (current.status === "finished" && candidate.status !== "finished") return null;
    if (candidate.version === current.version) {
      const currentServerNow = Date.parse(current.clock.serverNow);
      if (!Number.isFinite(currentServerNow) || candidateServerNow <= currentServerNow) {
        return null;
      }
    }
  }
  return {
    ...candidate,
    clock: { ...candidate.clock, clientReceivedAt },
  };
}

export function gamePollResponseBody(response: GamePollResponse) {
  return "game" in response
    ? { ok: true as const, game: response.game }
    : { ok: true as const, ...response };
}
