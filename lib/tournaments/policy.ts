import type { TournamentSettings, Standing } from "./types";
import { GameServiceError } from "@/lib/game/gameServiceError";

export const MONTHLY_GAMES = 5;
export const REQUIRED_RATED_GAMES = 10;
export const READY_WINDOW_MS = 120_000;
export const QUEUE_LEASE_MS = 30_000;
export const CATEGORY_LABELS = [
  "30–21 kyu",
  "20–11 kyu",
  "10–1 kyu",
  "Dan",
] as const;

export function tournamentCategory(rating: number): number {
  return rating < 1000 ? 0 : rating < 1500 ? 1 : rating < 2000 ? 2 : 3;
}

export function monthlyWindow(now = new Date()) {
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return {
    month: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    startsAt: new Date(end.getTime() - 7 * 86_400_000),
    endsAt: end,
  };
}

export function invalidTournament(code = "invalid_tournament_request"): never {
  throw new GameServiceError("Invalid tournament request.", 400, code);
}

export function parseTournamentSettings(
  body: Record<string, unknown>,
): TournamentSettings {
  const { name, boardSize, timeControl, maxPlayers, format } = body;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 60 ||
    /[\p{Cc}\p{Cf}]/u.test(name) ||
    (boardSize !== 9 && boardSize !== 13 && boardSize !== 19) ||
    (timeControl !== "blitz" &&
      timeControl !== "rapid" &&
      timeControl !== "classic") ||
    typeof maxPlayers !== "number" ||
    !Number.isInteger(maxPlayers) ||
    maxPlayers < 2 ||
    maxPlayers > 32 ||
    (format !== "round_robin" && format !== "knockout")
  )
    invalidTournament();
  return { name: name.trim(), boardSize, timeControl, maxPlayers, format };
}

/** Circle schedule: every opponent once, no player in two games in a round. */
export function roundRobin(
  ids: readonly string[],
): Array<Array<[string, string | null]>> {
  if (ids.length < 2) return [];
  const ring: Array<string | null> = [...ids];
  if (ring.length % 2) ring.push(null);
  const rounds: Array<Array<[string, string | null]>> = [];
  for (let round = 0; round < ring.length - 1; round++) {
    const pairs: Array<[string, string | null]> = [];
    for (let index = 0; index < ring.length / 2; index++) {
      let black = ring[index];
      let white = ring[ring.length - 1 - index];
      if ((round + index) % 2) [black, white] = [white, black];
      if (black) pairs.push([black, white]);
      else if (white) pairs.push([white, null]);
    }
    rounds.push(pairs);
    ring.splice(1, 0, ring.pop()!);
  }
  return rounds;
}

export function rankStandings(rows: Omit<Standing, "place">[]): Standing[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.points - a.points ||
      b.tiebreak - a.tiebreak ||
      b.wins - a.wins ||
      a.userId.localeCompare(b.userId),
  );
  let place = 1;
  return sorted.map((row, index) => {
    const previous = sorted[index - 1];
    if (
      previous &&
      (previous.points !== row.points ||
        previous.tiebreak !== row.tiebreak ||
        previous.wins !== row.wins)
    )
      place = index + 1;
    return { ...row, place };
  });
}

export function finalMonthlyStandings(rows: Standing[]): Standing[] {
  const complete = rankStandings(
    rows.filter((r) => r.played === MONTHLY_GAMES),
  );
  const incomplete = rankStandings(
    rows.filter((r) => r.played !== MONTHLY_GAMES),
  ).map((r) => ({ ...r, place: r.place + complete.length }));
  return [...complete, ...incomplete];
}
