import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";
import { GameServiceError } from "@/lib/game/gameService";
import type { Board, BoardSize, Stone } from "@/lib/game/types";
import type {
  PuzzleAttemptResult,
  PuzzleDifficulty,
  PuzzleHub,
  PuzzleKind,
  PuzzleSolution,
  PuzzleView,
} from "./types";

type PuzzleRow = {
  id: string;
  kind: PuzzleKind;
  daily_date: string | Date | null;
  board_size: BoardSize;
  to_play: Stone;
  board: Board;
  difficulty: PuzzleDifficulty;
  solution_move: string;
  solution_x: number;
  solution_y: number;
  explanation: { en: string; de: string };
  published_at: Date;
  attempt_count: number | null;
  solved: boolean | null;
  first_attempt_correct: boolean | null;
};

function isoDate(value: string | Date | null): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function solution(row: PuzzleRow): PuzzleSolution {
  return {
    move: row.solution_move,
    x: row.solution_x,
    y: row.solution_y,
    explanation: row.explanation,
  };
}

function view(row: PuzzleRow): PuzzleView {
  const solved = row.solved === true;
  return {
    id: row.id,
    kind: row.kind,
    dailyDate: isoDate(row.daily_date),
    boardSize: row.board_size,
    toPlay: row.to_play,
    board: row.board,
    difficulty: row.difficulty,
    publishedAt: row.published_at.toISOString(),
    attemptCount: row.attempt_count ?? 0,
    solved,
    firstAttemptCorrect: row.first_attempt_correct,
    solution: solved ? solution(row) : null,
  };
}

const SELECT_PUZZLE = `
  SELECT puzzle.id, puzzle.kind, puzzle.daily_date, puzzle.board_size,
         puzzle.to_play, puzzle.board, puzzle.difficulty, puzzle.solution_move,
         puzzle.solution_x, puzzle.solution_y, puzzle.explanation,
         puzzle.published_at, attempt.attempt_count, attempt.solved,
         attempt.first_attempt_correct
    FROM puzzles puzzle
    LEFT JOIN puzzle_attempts attempt
      ON attempt.puzzle_id = puzzle.id AND attempt.player_key = $1`;

export async function readPuzzleHub(
  playerKey: string,
  mode: PuzzleKind,
): Promise<PuzzleHub> {
  const suffix = mode === "daily"
    ? "WHERE puzzle.kind = 'daily' AND puzzle.daily_date = CURRENT_DATE ORDER BY puzzle.id LIMIT 1"
    : "WHERE puzzle.kind = 'practice' ORDER BY COALESCE(attempt.solved, false), puzzle.published_at DESC, puzzle.id LIMIT 24";
  const result = await query<PuzzleRow>(`${SELECT_PUZZLE} ${suffix}`, [playerKey]);
  return {
    status: result.rows.length > 0 ? "ready" : "generating",
    mode,
    puzzles: result.rows.map(view),
  };
}

async function lockPuzzle(
  client: PoolClient,
  puzzleId: string,
  playerKey: string,
): Promise<PuzzleRow | null> {
  const result = await client.query<PuzzleRow>(
    `${SELECT_PUZZLE}
      WHERE puzzle.id = $2
      FOR SHARE OF puzzle`,
    [playerKey, puzzleId],
  );
  return result.rows[0] ?? null;
}

export async function attemptPuzzle(
  puzzleId: string,
  playerKey: string,
  selected: { x: number; y: number },
): Promise<PuzzleAttemptResult> {
  return withTransaction(async (client) => {
    const puzzle = await lockPuzzle(client, puzzleId, playerKey);
    if (!puzzle) throw new GameServiceError("Puzzle not found.", 404, "puzzle_not_found");
    if (
      selected.x < 0
      || selected.y < 0
      || selected.x >= puzzle.board_size
      || selected.y >= puzzle.board_size
      || puzzle.board[selected.y]?.[selected.x] !== null
    ) {
      throw new GameServiceError("That intersection is not available.", 409, "puzzle_move_unavailable");
    }

    const correct = selected.x === puzzle.solution_x && selected.y === puzzle.solution_y;
    const attempt = await client.query<{
      attempt_count: number;
      solved: boolean;
      first_attempt_correct: boolean;
    }>(
      `INSERT INTO puzzle_attempts (
         puzzle_id, player_key, attempt_count, solved, first_attempt_correct,
         selected_x, selected_y, last_attempt_at, solved_at
       )
       VALUES ($1, $2, 1, $5, $5, $3, $4, NOW(), CASE WHEN $5 THEN NOW() END)
       ON CONFLICT (puzzle_id, player_key) DO UPDATE
         SET attempt_count = puzzle_attempts.attempt_count + 1,
             solved = puzzle_attempts.solved OR EXCLUDED.solved,
             first_attempt_correct = COALESCE(
               puzzle_attempts.first_attempt_correct,
               EXCLUDED.first_attempt_correct
             ),
             selected_x = EXCLUDED.selected_x,
             selected_y = EXCLUDED.selected_y,
             last_attempt_at = NOW(),
             solved_at = CASE
               WHEN puzzle_attempts.solved THEN puzzle_attempts.solved_at
               WHEN EXCLUDED.solved THEN NOW()
               ELSE NULL
             END
       RETURNING attempt_count, solved, first_attempt_correct`,
      [puzzleId, playerKey, selected.x, selected.y, correct],
    );
    const state = attempt.rows[0];
    if (!state) throw new Error("Puzzle attempt did not return a result.");
    return {
      puzzleId,
      correct,
      solved: state.solved,
      attemptCount: state.attempt_count,
      firstAttemptCorrect: state.first_attempt_correct,
      solution: state.solved ? solution(puzzle) : null,
    };
  });
}
