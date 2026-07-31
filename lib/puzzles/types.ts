import type { Board, BoardSize, Stone } from "@/lib/game/types";

export type PuzzleKind = "daily" | "practice";
export type PuzzleDifficulty = "beginner" | "intermediate" | "advanced";

export type PuzzleSolution = {
  move: string;
  x: number;
  y: number;
  explanation: { en: string; de: string };
};

export type PuzzleView = {
  id: string;
  kind: PuzzleKind;
  dailyDate: string | null;
  boardSize: BoardSize;
  toPlay: Stone;
  board: Board;
  difficulty: PuzzleDifficulty;
  publishedAt: string;
  attemptCount: number;
  solved: boolean;
  firstAttemptCorrect: boolean | null;
  solution: PuzzleSolution | null;
};

export type PuzzleHub = {
  status: "ready" | "generating";
  mode: PuzzleKind;
  puzzles: PuzzleView[];
};

export type PuzzleAttemptResult = {
  puzzleId: string;
  correct: boolean;
  solved: boolean;
  attemptCount: number;
  firstAttemptCorrect: boolean;
  solution: PuzzleSolution | null;
};
