import type { Board, BoardSize, Stone } from "@/lib/game/types";

export type PuzzleKind = "daily" | "practice";
export type PuzzleDifficulty = "beginner" | "intermediate" | "advanced";
export const PUZZLE_CATEGORIES = [
  "life_and_death",
  "tesuji",
  "capturing_race",
  "endgame",
] as const;
export type PuzzleCategory = typeof PUZZLE_CATEGORIES[number];
export const PUZZLES_PER_CATEGORY = 10;
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
    explanation: { en: string; de: string };
  }>;
  fallbackExplanation: { en: string; de: string };
};

export type PuzzleSolution = {
  move: string;
  x: number;
  y: number;
  explanation: { en: string; de: string };
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
};

export type PuzzleHub = {
  status: "ready" | "generating";
  mode: PuzzleKind;
  puzzles: PuzzleView[];
  expectedPerCategory: number;
};

export type PuzzleAttemptResult = {
  puzzleId: string;
  correct: boolean;
  outcome: "continue" | "retry" | "solved";
  solved: boolean;
  attemptCount: number;
  firstAttemptCorrect: boolean | null;
  variationProgress: PuzzlePly[];
  variationRevision: number;
  displayLine: PuzzlePly[];
  feedback: { en: string; de: string } | null;
  solution: PuzzleSolution | null;
};
