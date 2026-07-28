import type { BoardSize } from "@/lib/game/types";

export type LeaderboardEntry = {
  position: number;
  playerName: string;
  games: number;
  wins: number;
  rating: number;
};

export type PublicLeaderboardSnapshot = {
  boardSize: BoardSize;
  leaderboard: LeaderboardEntry[];
  observedAt: string;
};

const MAX_LEADERBOARD_ENTRIES = 100;
const MAX_PUBLIC_PLAYER_NAME_LENGTH = 80;
const MAX_POSTGRES_INT = 2_147_483_647;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function parseObservedAt(value: unknown, now: number): string {
  if (typeof value !== "string") throw new Error("Leaderboard freshness is missing.");
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString() !== value
    || timestamp > now + MAX_FUTURE_SKEW_MS
  ) {
    throw new Error("Leaderboard freshness is invalid.");
  }
  return value;
}

export function parsePublicLeaderboardSnapshot(
  value: unknown,
  expectedBoardSize: BoardSize,
  now = Date.now(),
): PublicLeaderboardSnapshot {
  if (!isRecord(value) || value.boardSize !== expectedBoardSize) {
    throw new Error("Leaderboard board size is invalid.");
  }
  if (
    !Array.isArray(value.leaderboard)
    || value.leaderboard.length > MAX_LEADERBOARD_ENTRIES
  ) {
    throw new Error("Leaderboard entries are invalid.");
  }

  const leaderboard = value.leaderboard.map((entry, index): LeaderboardEntry => {
    if (!isRecord(entry)) throw new Error("Leaderboard entry is invalid.");
    const playerName = typeof entry.playerName === "string" ? entry.playerName.trim() : "";
    if (
      entry.position !== index + 1
      || !isBoundedInteger(entry.position, 1, MAX_LEADERBOARD_ENTRIES)
      || playerName.length < 1
      || playerName.length > MAX_PUBLIC_PLAYER_NAME_LENGTH
      || !isBoundedInteger(entry.games, 1, MAX_POSTGRES_INT)
      || !isBoundedInteger(entry.wins, 0, entry.games)
      || !isBoundedInteger(entry.rating, 100, MAX_POSTGRES_INT)
    ) {
      throw new Error("Leaderboard entry is invalid.");
    }
    return {
      position: entry.position,
      playerName,
      games: entry.games,
      wins: entry.wins,
      rating: entry.rating,
    };
  });

  return {
    boardSize: expectedBoardSize,
    leaderboard,
    observedAt: parseObservedAt(value.observedAt, now),
  };
}
