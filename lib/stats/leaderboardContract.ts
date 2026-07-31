export type LeaderboardEntry = {
  position: number;
  playerName: string;
  games: number;
  wins: number;
  rating: number;
  ratingDeviation: number;
};

export type PublicLeaderboardSnapshot = {
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
  now = Date.now(),
): PublicLeaderboardSnapshot {
  if (!isRecord(value)) throw new Error("Leaderboard response is invalid.");
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
      || typeof entry.rating !== "number"
      || !Number.isFinite(entry.rating)
      || entry.rating < -10000
      || entry.rating > 10000
      || typeof entry.ratingDeviation !== "number"
      || !Number.isFinite(entry.ratingDeviation)
      || entry.ratingDeviation <= 0
      || entry.ratingDeviation > 10000
    ) {
      throw new Error("Leaderboard entry is invalid.");
    }
    return {
      position: entry.position,
      playerName,
      games: entry.games,
      wins: entry.wins,
      rating: entry.rating,
      ratingDeviation: entry.ratingDeviation,
    };
  });

  return {
    leaderboard,
    observedAt: parseObservedAt(value.observedAt, now),
  };
}
