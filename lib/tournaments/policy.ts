import type { TournamentSettings, Standing } from "./types";
import { GameServiceError } from "@/lib/game/gameServiceError";
import { deriveGoRank } from "@/lib/rating/rankPolicy";

export const MONTHLY_GAMES = 5;
export const RAPID_GROUP_SIZE = 24;
export const CLASSIC_HOURS = [8, 16, 20] as const;
export const CLASSIC_READY_MS = 300_000;
export const CLASSIC_TIME = {
  mainTimeSeconds: 3600,
  byoYomiPeriods: 3,
  byoYomiSeconds: 30,
};

export function classicEligible(rating: number): boolean {
  const rank = deriveGoRank(rating);
  return rank.kind === "dan" || rank.value <= 10;
}

/** Five consecutive days, followed by two buffer days before monthly closure. */
export function classicSchedule(start: Date): Date[] {
  return Array.from(
    { length: MONTHLY_GAMES },
    (_, i) => new Date(start.getTime() + i * 86_400_000),
  );
}

export function nextMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
}

/** Balanced fields, each with 6–32 entrants. Never create a tiny overflow field. */
export function classicGroups(ids: string[]): string[][] {
  if (ids.length < 6) return [];
  const count = Math.ceil(ids.length / 32);
  const base = Math.floor(ids.length / count);
  let cursor = 0;
  return Array.from({ length: count }, (_, i) => {
    const size = base + (i < ids.length % count ? 1 : 0);
    const group = ids.slice(cursor, cursor + size);
    cursor += size;
    return group;
  });
}

/** Score-first Swiss pairing, no repeat opponents; lower score receives a bye. */
export function swissPairs(
  rows: Standing[],
  history: Array<{ black_id: string | null; white_id: string | null }>,
  round: number,
): Array<[string, string | null]> {
  const seen = new Set(
    history
      .filter((m) => m.white_id)
      .map((m) => [m.black_id, m.white_id].sort().join(":")),
  );
  const byes = new Set(
    history.filter((m) => !m.white_id).map((m) => m.black_id),
  );
  const colors = new Map<string, number>();
  for (const m of history) {
    if (m.black_id) colors.set(m.black_id, (colors.get(m.black_id) ?? 0) + 1);
    if (m.white_id) colors.set(m.white_id, (colors.get(m.white_id) ?? 0) - 1);
  }
  const sorted = [...rows].sort(
    (a, b) =>
      b.points - a.points ||
      b.rating - a.rating ||
      a.userId.localeCompare(b.userId),
  );
  const byeCandidates =
    sorted.length % 2
      ? [...sorted].reverse().filter((r) => !byes.has(r.userId))
      : [null];
  let budget = 100_000;
  function pair(remaining: Standing[]): Array<[string, string | null]> | null {
    if (!remaining.length) return [];
    if (--budget < 0) return null;
    // Most constrained player first avoids greedy dead ends in the final rounds.
    const legal = (a: Standing, b: Standing) =>
      !seen.has([a.userId, b.userId].sort().join(":"));
    const first = [...remaining].sort(
      (a, b) =>
        remaining.filter((r) => r !== a && legal(a, r)).length -
        remaining.filter((r) => r !== b && legal(b, r)).length,
    )[0];
    const opponents = remaining
      .filter((r) => r !== first && legal(first, r))
      .sort(
        (a, b) =>
          Math.abs(first.points - a.points) -
            Math.abs(first.points - b.points) ||
          Math.abs(first.rating - a.rating) - Math.abs(first.rating - b.rating),
      );
    for (const opponent of opponents) {
      const rest = pair(remaining.filter((r) => r !== first && r !== opponent));
      if (rest) {
        const blackFirst =
          (colors.get(first.userId) ?? 0) <
            (colors.get(opponent.userId) ?? 0) ||
          ((colors.get(first.userId) ?? 0) ===
            (colors.get(opponent.userId) ?? 0) &&
            round % 2 === 1);
        return [
          [
            blackFirst ? first.userId : opponent.userId,
            blackFirst ? opponent.userId : first.userId,
          ],
          ...rest,
        ];
      }
    }
    return null;
  }
  for (const bye of byeCandidates) {
    const pairs = pair(sorted.filter((r) => r !== bye));
    if (pairs) return bye ? [...pairs, [bye.userId, null]] : pairs;
  }
  throw new Error("No legal Swiss pairing available.");
}
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
