import type { Board, BoardSize, Stone } from "@/lib/game/types";
import type { LocalizedText } from "@/lib/i18n/config";

export type PuzzleKind = "daily" | "practice";
export type PuzzleDifficulty = "beginner" | "intermediate" | "advanced";
export const CURATED_PUZZLE_CATEGORIES = [
  "life_and_death",
  "tesuji",
  "capturing_race",
  "endgame",
] as const;
export const GOKYO_SHUMYO_CATEGORIES = [
  "gokyo_life",
  "gokyo_death",
  "gokyo_ko",
] as const;
export const PUZZLE_CATEGORIES = [
  ...CURATED_PUZZLE_CATEGORIES,
  ...GOKYO_SHUMYO_CATEGORIES,
] as const;
export type PuzzleCategory = typeof PUZZLE_CATEGORIES[number];
export type CuratedPuzzleCategory = typeof CURATED_PUZZLE_CATEGORIES[number];
export type GokyoShumyoCategory = typeof GOKYO_SHUMYO_CATEGORIES[number];
export const PUZZLES_PER_CATEGORY = 10;
export const DAILY_PUZZLE_CYCLE_LENGTH = CURATED_PUZZLE_CATEGORIES.length * PUZZLES_PER_CATEGORY;
export const PUZZLE_KYU_LADDER = [30, 28, 26, 24, 22, 20, 19, 18, 17, 15] as const;

export type PuzzlePly = {
  color: Stone;
  move: string;
  x: number;
  y: number;
};

export type PuzzleVariation = {
  version: 1;
  mainLine: PuzzlePly[];
  refutations: Array<{
    userMove: PuzzlePly;
    reply: PuzzlePly | null;
    explanation: LocalizedText;
  }>;
  fallbackExplanation: LocalizedText;
};

export type PuzzleSolution = {
  move: string;
  x: number;
  y: number;
  explanation: LocalizedText;
  line: PuzzlePly[];
};

export type PuzzleView = {
  id: string;
  kind: PuzzleKind;
  category: PuzzleCategory | null;
  rankKyu: number | null;
  collectionOrder: number | null;
  dailyDate: string | null;
  boardSize: BoardSize;
  toPlay: Stone;
  board: Board;
  difficulty: PuzzleDifficulty;
  publishedAt: string;
  attemptCount: number;
  solved: boolean;
  firstAttemptCorrect: boolean | null;
  variationProgress: PuzzlePly[];
  variationRevision: number;
  solution: PuzzleSolution | null;
  viewportSize?: number;
  goal?: LocalizedText;
  targetStones?: Array<{ x: number; y: number }>;
};

export type PuzzleHub = {
  status: "ready" | "generating";
  mode: PuzzleKind;
  puzzles: PuzzleView[];
  expectedPerCategory: number;
  categoryCounts: Record<PuzzleCategory, number>;
  dailyCycleLength: number;
};

export type PuzzleAttemptResult = {
  puzzleId: string;
  correct: boolean;
  outcome: "continue" | "retry" | "solved" | "unknown";
  solved: boolean;
  attemptCount: number;
  firstAttemptCorrect: boolean | null;
  variationProgress: PuzzlePly[];
  variationRevision: number;
  displayLine: PuzzlePly[];
  displayLineIsComplete?: boolean;
  feedback: LocalizedText | null;
  solution: PuzzleSolution | null;
};

export type PuzzleHint = {
  x: number;
  y: number;
};

export type PuzzleAttemptAction = "play" | "pass" | "undo" | "restart";
export type PuzzleAttemptInput = { x: number; y: number; revision: number; action?: PuzzleAttemptAction };
