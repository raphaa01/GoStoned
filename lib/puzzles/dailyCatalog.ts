import type { Board, Position } from "@/lib/game/types";
import { curatedPuzzle } from "./curatedCatalog";
import { DAILY_PUZZLE_CYCLE_LENGTH, type PuzzleCategory } from "./types";

export { DAILY_PUZZLE_CYCLE_LENGTH } from "./types";
export const DAILY_PUZZLE_CYCLE_START = "2026-09-08";

type DailyPuzzleSource = {
  category: PuzzleCategory;
  sourceOrder: number;
  rankKyu: number;
};

// Progressively harder, distinct problems from all four curated categories.
// Interleaving the themes keeps consecutive days varied while preserving a
// deterministic 20-day cycle.
const DAILY_SOURCES: readonly DailyPuzzleSource[] = [
  { category: "life_and_death", sourceOrder: 2, rankKyu: 30 },
  { category: "tesuji", sourceOrder: 1, rankKyu: 30 },
  { category: "capturing_race", sourceOrder: 1, rankKyu: 30 },
  { category: "endgame", sourceOrder: 1, rankKyu: 30 },
  { category: "life_and_death", sourceOrder: 3, rankKyu: 26 },
  { category: "tesuji", sourceOrder: 3, rankKyu: 26 },
  { category: "capturing_race", sourceOrder: 2, rankKyu: 26 },
  { category: "endgame", sourceOrder: 2, rankKyu: 26 },
  { category: "life_and_death", sourceOrder: 5, rankKyu: 22 },
  { category: "tesuji", sourceOrder: 5, rankKyu: 22 },
  { category: "capturing_race", sourceOrder: 5, rankKyu: 22 },
  { category: "endgame", sourceOrder: 4, rankKyu: 22 },
  { category: "life_and_death", sourceOrder: 7, rankKyu: 19 },
  { category: "tesuji", sourceOrder: 7, rankKyu: 19 },
  { category: "capturing_race", sourceOrder: 7, rankKyu: 19 },
  { category: "endgame", sourceOrder: 7, rankKyu: 19 },
  { category: "life_and_death", sourceOrder: 9, rankKyu: 15 },
  { category: "tesuji", sourceOrder: 10, rankKyu: 15 },
  { category: "capturing_race", sourceOrder: 9, rankKyu: 15 },
  { category: "tesuji", sourceOrder: 9, rankKyu: 15 },
] as const;

export type DailyPuzzle = {
  cycleOrder: number;
  category: PuzzleCategory;
  rankKyu: number;
  sourceId: string;
  board: Board;
  candidateMoves: Position[];
  localRegion: Position[];
};

function focusedRegion(candidateMoves: readonly Position[]): Position[] {
  const minX = Math.max(0, Math.min(...candidateMoves.map((point) => point.x)) - 3);
  const maxX = Math.min(12, Math.max(...candidateMoves.map((point) => point.x)) + 3);
  const minY = Math.max(0, Math.min(...candidateMoves.map((point) => point.y)) - 3);
  const maxY = Math.min(12, Math.max(...candidateMoves.map((point) => point.y)) + 3);
  const region: Position[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) region.push({ x, y });
  }
  return region;
}

function utcDay(date: string | Date): number {
  const value = typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Daily puzzle date is invalid.");
  const [year, month, day] = value.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(timestamp)) throw new Error("Daily puzzle date is invalid.");
  return Math.floor(timestamp / 86_400_000);
}

export function dailyPuzzleCycleOrder(date: string | Date): number {
  const offset = utcDay(date) - utcDay(DAILY_PUZZLE_CYCLE_START);
  return ((offset % DAILY_PUZZLE_CYCLE_LENGTH) + DAILY_PUZZLE_CYCLE_LENGTH)
    % DAILY_PUZZLE_CYCLE_LENGTH + 1;
}

export function dailyPuzzleAt(cycleOrder: number): DailyPuzzle {
  if (!Number.isInteger(cycleOrder) || cycleOrder < 1 || cycleOrder > DAILY_PUZZLE_CYCLE_LENGTH) {
    throw new Error("Unknown daily puzzle cycle position.");
  }
  const source = DAILY_SOURCES[cycleOrder - 1];
  if (!source) throw new Error("Daily puzzle catalog is incomplete.");
  const curated = curatedPuzzle(source.category, source.sourceOrder);
  return {
    cycleOrder,
    category: source.category,
    rankKyu: source.rankKyu,
    sourceId: `daily-v1:${cycleOrder}:${curated.sourceId}`,
    board: curated.board,
    candidateMoves: curated.candidateMoves,
    localRegion: focusedRegion(curated.candidateMoves),
  };
}

export function dailyPuzzleForDate(date: string | Date): DailyPuzzle {
  return dailyPuzzleAt(dailyPuzzleCycleOrder(date));
}
