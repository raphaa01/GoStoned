import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";
import { toGtpCoordinate } from "@/lib/analysis/coordinates";
import { applyMove } from "@/lib/game/goEngine";
import { GameServiceError } from "@/lib/game/gameService";
import type { Board, BoardSize, Stone } from "@/lib/game/types";
import { SUPPORTED_LOCALES, type LocalizedText } from "@/lib/i18n/config";
import {
  PUZZLES_PER_CATEGORY,
  type PuzzleAttemptResult,
  type PuzzleCategory,
  type PuzzleDifficulty,
  type PuzzleHub,
  type PuzzleKind,
  type PuzzlePly,
  type PuzzleSolution,
  type PuzzleVariation,
  type PuzzleView,
} from "./types";

type PuzzleRow = {
  id: string;
  kind: PuzzleKind;
  category: PuzzleCategory | null;
  rank_kyu: number | null;
  collection_order: number | null;
  daily_date: string | Date | null;
  board_size: BoardSize;
  to_play: Stone;
  board: Board;
  difficulty: PuzzleDifficulty;
  solution_move: string;
  solution_x: number;
  solution_y: number;
  explanation: LocalizedText;
  variation: unknown;
  published_at: Date;
  attempt_count: number | null;
  solved: boolean | null;
  first_attempt_correct: boolean | null;
  variation_progress: unknown;
  variation_revision: number | null;
};

type AttemptState = {
  attempt_count: number;
  solved: boolean;
  first_attempt_correct: boolean | null;
  variation_revision: number;
};

function isoDate(value: string | Date | null): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePly(value: unknown, boardSize: BoardSize): PuzzlePly {
  if (!isRecord(value)) throw new Error("Stored puzzle variation contains an invalid move.");
  const { color, move, x, y } = value;
  if (
    (color !== "black" && color !== "white")
    || typeof move !== "string"
    || !Number.isInteger(x)
    || !Number.isInteger(y)
    || (x as number) < 0
    || (y as number) < 0
    || (x as number) >= boardSize
    || (y as number) >= boardSize
  ) {
    throw new Error("Stored puzzle variation contains an invalid coordinate.");
  }
  return { color, move, x: x as number, y: y as number };
}

function parseLocalized(value: unknown): LocalizedText {
  if (!isRecord(value) || typeof value.en !== "string" || typeof value.de !== "string") {
    throw new Error("Stored puzzle explanation is invalid.");
  }
  return Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [
    locale,
    typeof value[locale] === "string" ? value[locale] : value.en,
  ])) as LocalizedText;
}

function parseVariation(row: PuzzleRow): PuzzleVariation | null {
  if (row.variation === null) return null;
  if (!isRecord(row.variation) || row.variation.version !== 1) {
    throw new Error("Stored puzzle variation version is unsupported.");
  }
  if (!Array.isArray(row.variation.mainLine) || !Array.isArray(row.variation.refutations)) {
    throw new Error("Stored puzzle variation is incomplete.");
  }
  const mainLine = row.variation.mainLine.map((ply) => parsePly(ply, row.board_size));
  if (mainLine.length < 3 || mainLine.length > 5) {
    throw new Error("Stored puzzle main line has an invalid length.");
  }
  let expectedColor = row.to_play;
  for (const ply of mainLine) {
    if (ply.color !== expectedColor) throw new Error("Stored puzzle colors do not alternate.");
    expectedColor = expectedColor === "black" ? "white" : "black";
  }
  const refutations = row.variation.refutations.slice(0, 8).map((entry) => {
    if (!isRecord(entry)) throw new Error("Stored puzzle refutation is invalid.");
    return {
      userMove: parsePly(entry.userMove, row.board_size),
      reply: entry.reply === null ? null : parsePly(entry.reply, row.board_size),
      explanation: parseLocalized(entry.explanation),
    };
  });
  return {
    version: 1,
    mainLine,
    refutations,
    fallbackExplanation: parseLocalized(row.variation.fallbackExplanation),
  };
}

function parseProgress(row: PuzzleRow): PuzzlePly[] {
  if (row.variation_progress === null || row.variation_progress === undefined) return [];
  if (!Array.isArray(row.variation_progress)) {
    throw new Error("Stored puzzle progress is invalid.");
  }
  return row.variation_progress.map((ply) => parsePly(ply, row.board_size));
}

function solution(row: PuzzleRow, variation = parseVariation(row)): PuzzleSolution {
  return {
    move: row.solution_move,
    x: row.solution_x,
    y: row.solution_y,
    explanation: row.explanation,
    line: variation?.mainLine ?? [{
      color: row.to_play,
      move: row.solution_move,
      x: row.solution_x,
      y: row.solution_y,
    }],
  };
}

function view(row: PuzzleRow): PuzzleView {
  const solved = row.solved === true;
  const variation = parseVariation(row);
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    rankKyu: row.rank_kyu,
    collectionOrder: row.collection_order,
    dailyDate: isoDate(row.daily_date),
    boardSize: row.board_size,
    toPlay: row.to_play,
    board: row.board,
    difficulty: row.difficulty,
    publishedAt: row.published_at.toISOString(),
    attemptCount: row.attempt_count ?? 0,
    solved,
    firstAttemptCorrect: row.first_attempt_correct,
    variationProgress: parseProgress(row),
    variationRevision: row.variation_revision ?? 0,
    solution: solved ? solution(row, variation) : null,
  };
}

const SELECT_PUZZLE = `
  SELECT puzzle.id, puzzle.kind, puzzle.category, puzzle.rank_kyu,
         puzzle.collection_order, puzzle.daily_date, puzzle.board_size,
         puzzle.to_play, puzzle.board, puzzle.difficulty, puzzle.solution_move,
         puzzle.solution_x, puzzle.solution_y, puzzle.explanation,
         puzzle.variation, puzzle.published_at, attempt.attempt_count,
         attempt.solved, attempt.first_attempt_correct,
         attempt.variation_progress, attempt.variation_revision
    FROM puzzles puzzle
    LEFT JOIN puzzle_attempts attempt
      ON attempt.puzzle_id = puzzle.id AND attempt.player_key = $1`;

export async function readPuzzleHub(
  playerKey: string,
  mode: PuzzleKind,
): Promise<PuzzleHub> {
  const suffix = mode === "daily"
    ? "WHERE puzzle.kind = 'daily' AND puzzle.daily_date = CURRENT_DATE ORDER BY puzzle.id LIMIT 1"
    : `WHERE puzzle.kind = 'practice' AND puzzle.category IS NOT NULL
       ORDER BY puzzle.category, puzzle.collection_order, puzzle.id`;
  const result = await query<PuzzleRow>(`${SELECT_PUZZLE} ${suffix}`, [playerKey]);
  return {
    status: result.rows.length > 0 ? "ready" : "generating",
    mode,
    puzzles: result.rows.map(view),
    expectedPerCategory: PUZZLES_PER_CATEGORY,
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

function appliedLine(board: Board, line: readonly PuzzlePly[]): Board {
  let current = board;
  for (const ply of line) {
    const applied = applyMove(current, ply.color, ply.x, ply.y);
    if (!applied.ok) throw new Error(`Stored puzzle line is illegal (${applied.error}).`);
    current = applied.board;
  }
  return current;
}

async function saveVariationAttempt(
  client: PoolClient,
  input: {
    puzzleId: string;
    playerKey: string;
    selected: { x: number; y: number };
    progress: readonly PuzzlePly[];
    solved: boolean;
    firstAttemptCorrect: boolean | null;
  },
): Promise<AttemptState> {
  const result = await client.query<AttemptState>(
    `INSERT INTO puzzle_attempts (
       puzzle_id, player_key, attempt_count, solved, first_attempt_correct,
       selected_x, selected_y, variation_progress, variation_revision,
       last_attempt_at, solved_at
     )
     VALUES ($1, $2, 1, $5, $6, $3, $4, $7::jsonb, 1, NOW(),
             CASE WHEN $5 THEN NOW() END)
     ON CONFLICT (puzzle_id, player_key) DO UPDATE
       SET attempt_count = puzzle_attempts.attempt_count + 1,
           solved = puzzle_attempts.solved OR EXCLUDED.solved,
           first_attempt_correct = COALESCE(
             puzzle_attempts.first_attempt_correct,
             EXCLUDED.first_attempt_correct
           ),
           selected_x = EXCLUDED.selected_x,
           selected_y = EXCLUDED.selected_y,
           variation_progress = CASE
             WHEN puzzle_attempts.solved THEN puzzle_attempts.variation_progress
             ELSE EXCLUDED.variation_progress
           END,
           variation_revision = puzzle_attempts.variation_revision + 1,
           last_attempt_at = NOW(),
           solved_at = CASE
             WHEN puzzle_attempts.solved THEN puzzle_attempts.solved_at
             WHEN EXCLUDED.solved THEN NOW()
             ELSE NULL
           END
     RETURNING attempt_count, solved, first_attempt_correct, variation_revision`,
    [
      input.puzzleId,
      input.playerKey,
      input.selected.x,
      input.selected.y,
      input.solved,
      input.firstAttemptCorrect,
      JSON.stringify(input.progress),
    ],
  );
  const state = result.rows[0];
  if (!state) throw new Error("Puzzle attempt did not return a result.");
  return state;
}

async function attemptDailyPuzzle(
  client: PoolClient,
  puzzle: PuzzleRow,
  playerKey: string,
  selected: { x: number; y: number },
): Promise<PuzzleAttemptResult> {
  const correct = selected.x === puzzle.solution_x && selected.y === puzzle.solution_y;
  const attempt = await client.query<AttemptState>(
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
     RETURNING attempt_count, solved, first_attempt_correct, variation_revision`,
    [puzzle.id, playerKey, selected.x, selected.y, correct],
  );
  const state = attempt.rows[0];
  if (!state) throw new Error("Puzzle attempt did not return a result.");
  const played: PuzzlePly = {
    color: puzzle.to_play,
    move: toGtpCoordinate(puzzle.board_size, { ...selected, isPass: false }),
    ...selected,
  };
  return {
    puzzleId: puzzle.id,
    correct,
    outcome: state.solved ? "solved" : "retry",
    solved: state.solved,
    attemptCount: state.attempt_count,
    firstAttemptCorrect: state.first_attempt_correct,
    variationProgress: [],
    variationRevision: state.variation_revision,
    displayLine: [played],
    feedback: null,
    solution: state.solved ? solution(puzzle, null) : null,
  };
}

function legalReply(
  boardAfterUserMove: Board,
  color: Stone,
  candidates: readonly (PuzzlePly | null)[],
): PuzzlePly | null {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || candidate.color !== color) continue;
    const key = `${candidate.x}:${candidate.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const applied = applyMove(boardAfterUserMove, color, candidate.x, candidate.y);
    if (applied.ok) return candidate;
  }
  for (let y = 0; y < boardAfterUserMove.length; y += 1) {
    for (let x = 0; x < boardAfterUserMove.length; x += 1) {
      const applied = applyMove(boardAfterUserMove, color, x, y);
      if (!applied.ok) continue;
      return {
        color,
        move: toGtpCoordinate(boardAfterUserMove.length as BoardSize, { x, y, isPass: false }),
        x,
        y,
      };
    }
  }
  return null;
}

async function attemptVariationPuzzle(
  client: PoolClient,
  puzzle: PuzzleRow,
  playerKey: string,
  selected: { x: number; y: number; revision: number },
  variation: PuzzleVariation,
): Promise<PuzzleAttemptResult> {
  const progress = parseProgress(puzzle);
  const revision = puzzle.variation_revision ?? 0;
  if (selected.revision !== revision) {
    throw new GameServiceError(
      "The puzzle changed. Reload its current variation.",
      409,
      "puzzle_revision_conflict",
    );
  }
  if (puzzle.solved) {
    return {
      puzzleId: puzzle.id,
      correct: true,
      outcome: "solved",
      solved: true,
      attemptCount: puzzle.attempt_count ?? 0,
      firstAttemptCorrect: puzzle.first_attempt_correct,
      variationProgress: progress,
      variationRevision: revision,
      displayLine: [],
      feedback: null,
      solution: solution(puzzle, variation),
    };
  }
  if (progress.length % 2 !== 0 || progress.length >= variation.mainLine.length) {
    throw new Error("Stored puzzle progress is not at a player decision.");
  }
  const currentBoard = appliedLine(puzzle.board, progress);
  const userColor = variation.mainLine[progress.length]?.color ?? puzzle.to_play;
  const placed = applyMove(currentBoard, userColor, selected.x, selected.y);
  if (!placed.ok) {
    throw new GameServiceError("That intersection is not available.", 409, "puzzle_move_unavailable");
  }
  const userMove: PuzzlePly = {
    color: userColor,
    move: toGtpCoordinate(puzzle.board_size, { ...selected, isPass: false }),
    x: selected.x,
    y: selected.y,
  };
  const expected = variation.mainLine[progress.length];
  const correct = Boolean(expected && expected.x === selected.x && expected.y === selected.y);
  if (!correct) {
    const matching = progress.length === 0
      ? variation.refutations.find((entry) => (
        entry.userMove.x === selected.x && entry.userMove.y === selected.y
      ))
      : undefined;
    const intendedReply = variation.mainLine[progress.length + 1] ?? null;
    const reply = legalReply(placed.board, userColor === "black" ? "white" : "black", [
      matching?.reply ?? null,
      intendedReply,
      ...variation.refutations.map((entry) => entry.reply),
    ]);
    const state = await saveVariationAttempt(client, {
      puzzleId: puzzle.id,
      playerKey,
      selected,
      progress: [],
      solved: false,
      firstAttemptCorrect: false,
    });
    return {
      puzzleId: puzzle.id,
      correct: false,
      outcome: "retry",
      solved: false,
      attemptCount: state.attempt_count,
      firstAttemptCorrect: state.first_attempt_correct,
      variationProgress: [],
      variationRevision: state.variation_revision,
      displayLine: reply ? [userMove, reply] : [userMove],
      feedback: matching?.explanation ?? variation.fallbackExplanation,
      solution: null,
    };
  }

  const added: PuzzlePly[] = [expected];
  let boardAfterLine = placed.board;
  const opponentReply = variation.mainLine[progress.length + 1];
  if (opponentReply) {
    const replied = applyMove(boardAfterLine, opponentReply.color, opponentReply.x, opponentReply.y);
    if (!replied.ok) throw new Error("Stored puzzle reply is illegal.");
    boardAfterLine = replied.board;
    added.push(opponentReply);
  }
  void boardAfterLine;
  const nextProgress = [...progress, ...added];
  const solved = nextProgress.length >= variation.mainLine.length;
  const state = await saveVariationAttempt(client, {
    puzzleId: puzzle.id,
    playerKey,
    selected,
    progress: nextProgress,
    solved,
    firstAttemptCorrect: solved ? true : null,
  });
  return {
    puzzleId: puzzle.id,
    correct: true,
    outcome: solved ? "solved" : "continue",
    solved: state.solved,
    attemptCount: state.attempt_count,
    firstAttemptCorrect: state.first_attempt_correct,
    variationProgress: nextProgress,
    variationRevision: state.variation_revision,
    displayLine: added,
    feedback: null,
    solution: state.solved ? solution(puzzle, variation) : null,
  };
}

export async function attemptPuzzle(
  puzzleId: string,
  playerKey: string,
  selected: { x: number; y: number; revision: number },
  accountAccess: boolean,
): Promise<PuzzleAttemptResult> {
  return withTransaction(async (client) => {
    const puzzle = await lockPuzzle(client, puzzleId, playerKey);
    if (!puzzle) throw new GameServiceError("Puzzle not found.", 404, "puzzle_not_found");
    if (puzzle.kind === "practice" && !accountAccess) {
      throw new GameServiceError("Please log in first.", 401, "authentication_required");
    }
    if (
      selected.x < 0
      || selected.y < 0
      || selected.x >= puzzle.board_size
      || selected.y >= puzzle.board_size
    ) {
      throw new GameServiceError("That intersection is not available.", 409, "puzzle_move_unavailable");
    }
    const variation = parseVariation(puzzle);
    if (variation) {
      return attemptVariationPuzzle(client, puzzle, playerKey, selected, variation);
    }
    if (puzzle.board[selected.y]?.[selected.x] !== null) {
      throw new GameServiceError("That intersection is not available.", 409, "puzzle_move_unavailable");
    }
    return attemptDailyPuzzle(client, puzzle, playerKey, selected);
  });
}
