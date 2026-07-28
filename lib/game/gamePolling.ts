import type { GamePollResponse, GameState } from "./types";

export const FULL_GAME_REFRESH_INTERVAL_MS = 30_000;

export function parseKnownGameVersion(searchParams: URLSearchParams): number | null {
  const values = searchParams.getAll("knownVersion");
  if (values.length !== 1 || !/^(0|[1-9]\d*)$/.test(values[0])) return null;
  const version = Number(values[0]);
  return Number.isSafeInteger(version) ? version : null;
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
): GameState | null {
  if ("game" in response) return response.game;
  if (
    !current
    || response.gameId !== current.id
    || response.version !== current.version
  ) {
    return null;
  }
  return { ...current, clock: response.clock };
}

export function gamePollResponseBody(response: GamePollResponse) {
  return "game" in response
    ? { ok: true as const, game: response.game }
    : { ok: true as const, ...response };
}
