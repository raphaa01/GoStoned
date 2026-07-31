import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { fromGtpCoordinate, toGtpCoordinate, coordinateRegion } from "@/lib/analysis/coordinates";
import {
  ANALYSIS_ENGINE_CONTRACT_VERSION,
  type AnalysisInput,
  type AnalysisMove,
  type KataGoMoveInfo,
} from "@/lib/analysis/types";
import { deterministicUnit } from "@/lib/bot/identity";
import { query, withTransaction } from "@/lib/db";
import { applyMove, createEmptyBoard, replayMoves } from "@/lib/game/goEngine";
import type { Board, BoardSize, Stone, StoredMove } from "@/lib/game/types";
import type { PuzzleDifficulty, PuzzleKind } from "@/lib/puzzles/types";
import type { KataGoEngine } from "./engine";

type PuzzleJob = {
  id: string;
  kind: PuzzleKind;
  target_date: string | Date | null;
  board_size: BoardSize;
  attempts: number;
};

type SourceMoveRow = {
  move_number: number;
  color: Stone;
  x: number | null;
  y: number | null;
  is_pass: boolean;
  created_at: Date;
};

type SourceGameRow = {
  id: string;
  board_size: BoardSize;
  komi: string | number;
  rules: "chinese" | "japanese";
  move_count: number;
};

type PuzzlePosition = {
  input: AnalysisInput;
  board: Board;
  sourceGameId: string | null;
  sourceMoveNumber: number;
};

export type PuzzleLoopState = { activeJobId: string | null };

const puzzleWorkerId = `puzzle:${randomUUID()}`;

function storedMove(row: SourceMoveRow): StoredMove {
  return {
    moveNumber: row.move_number,
    color: row.color,
    x: row.x,
    y: row.y,
    isPass: row.is_pass,
    createdAt: row.created_at.toISOString(),
  };
}

function inputFromMoves(
  id: string,
  boardSize: BoardSize,
  komi: number,
  rules: "chinese" | "japanese",
  moves: readonly StoredMove[],
): AnalysisInput {
  return {
    contractVersion: ANALYSIS_ENGINE_CONTRACT_VERSION,
    gameId: id,
    gameVersion: moves.length,
    boardSize,
    komi,
    rules,
    moves: moves.map((move) => ({
      color: move.color,
      move: toGtpCoordinate(boardSize, move),
    })),
  };
}

async function sourceFromGame(job: PuzzleJob): Promise<PuzzlePosition | null> {
  const game = await query<SourceGameRow>(
    `SELECT game.id, game.board_size, game.komi, game.rules,
            COUNT(move.id)::int AS move_count
       FROM games game
       JOIN moves move ON move.game_id = game.id
      WHERE game.status = 'finished'
        AND game.board_size = $2
        AND game.rules IN ('chinese', 'japanese')
      GROUP BY game.id
     HAVING COUNT(move.id) >= 8
      ORDER BY MD5(game.id::text || $1)
      LIMIT 1`,
    [job.id, job.board_size],
  );
  const selectedGame = game.rows[0];
  if (!selectedGame) return null;
  const moves = await query<SourceMoveRow>(
    `SELECT move_number, color, x, y, is_pass, created_at
       FROM moves
      WHERE game_id = $1
      ORDER BY move_number`,
    [selectedGame.id],
  );
  const allMoves = moves.rows.map(storedMove);
  const maximum = Math.max(6, Math.min(allMoves.length - 1, 80));
  const sourceMoveNumber = Math.min(
    maximum,
    6 + Math.floor(deterministicUnit(`${job.id}:source-turn`) * Math.max(1, maximum - 5)),
  );
  const positionMoves = allMoves.slice(0, sourceMoveNumber);
  return {
    input: inputFromMoves(
      selectedGame.id,
      selectedGame.board_size,
      Number(selectedGame.komi),
      selectedGame.rules,
      positionMoves,
    ),
    board: replayMoves(selectedGame.board_size, positionMoves),
    sourceGameId: selectedGame.id,
    sourceMoveNumber,
  };
}

function syntheticPosition(job: PuzzleJob): PuzzlePosition {
  const moves: AnalysisMove[] = [];
  let board = createEmptyBoard(job.board_size);
  const edge = job.board_size === 9 ? 2 : 3;
  const far = job.board_size - 1 - edge;
  const center = Math.floor(job.board_size / 2);
  const candidates = [
    { x: edge, y: edge },
    { x: far, y: far },
    { x: edge, y: far },
    { x: far, y: edge },
    { x: center, y: edge },
    { x: center, y: far },
    { x: edge, y: center },
    { x: far, y: center },
    { x: center, y: center },
    { x: Math.max(0, center - 1), y: center },
    { x: Math.min(job.board_size - 1, center + 1), y: center },
    { x: center, y: Math.max(0, center - 1) },
  ].toSorted((left, right) => (
    deterministicUnit(`${job.id}:${left.x}:${left.y}`)
    - deterministicUnit(`${job.id}:${right.x}:${right.y}`)
  ));
  const targetMoves = job.board_size === 9 ? 8 : 10;
  for (let index = 0; index < targetMoves; index += 1) {
    const position = candidates[index];
    if (!position) break;
    const color: Stone = index % 2 === 0 ? "black" : "white";
    const applied = applyMove(board, color, position.x, position.y);
    if (!applied.ok) break;
    board = applied.board;
    moves.push({
      color,
      move: toGtpCoordinate(job.board_size, {
        x: position.x,
        y: position.y,
        isPass: false,
      }),
    });
  }
  return {
    input: {
      contractVersion: ANALYSIS_ENGINE_CONTRACT_VERSION,
      gameId: `puzzle-seed:${job.id}`,
      gameVersion: moves.length,
      boardSize: job.board_size,
      komi: 7.5,
      rules: "chinese",
      moves,
    },
    board,
    sourceGameId: null,
    sourceMoveNumber: moves.length,
  };
}

function puzzleDifficulty(gap: number): PuzzleDifficulty {
  if (gap >= 3) return "beginner";
  if (gap >= 1.25) return "intermediate";
  return "advanced";
}

function explanation(
  best: KataGoMoveInfo,
  second: KataGoMoveInfo | undefined,
  boardSize: BoardSize,
) {
  const gap = second ? Math.max(0, best.scoreLead - second.scoreLead) : 0;
  const region = coordinateRegion(best.move, boardSize);
  const regionEn = { corner: "corner", side: "side", center: "center", pass: "board" }[region];
  const regionDe = { corner: "Ecke", side: "Seite", center: "Mitte", pass: "Brett" }[region];
  const points = gap.toFixed(1);
  return {
    en: `KataGo prefers ${best.move} in the ${regionEn}. It keeps about ${points} more points than the closest analyzed alternative while preserving the strongest continuation.`,
    de: `KataGo bevorzugt ${best.move} in der ${regionDe}. Der Zug bewahrt ungefähr ${points} Punkte mehr als die nächstbeste untersuchte Alternative und hält die stärkste Fortsetzung offen.`,
  };
}

async function completePuzzle(
  client: PoolClient,
  job: PuzzleJob,
  position: PuzzlePosition,
  toPlay: Stone,
  best: KataGoMoveInfo,
  candidates: readonly KataGoMoveInfo[],
  visits: number,
  engineVersion: string,
  modelName: string,
): Promise<void> {
  const coordinate = fromGtpCoordinate(job.board_size, best.move);
  if (coordinate.x === undefined || coordinate.y === undefined) {
    throw new Error("KataGo puzzle solution must place a stone.");
  }
  const second = candidates[1];
  const gap = second ? Math.max(0, best.scoreLead - second.scoreLead) : 0;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO puzzles (
       kind, daily_date, board_size, to_play, position_moves, board,
       solution_move, solution_x, solution_y, alternatives, difficulty,
       explanation, engine_version, model_name, visits,
       source_game_id, source_move_number
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb,
             $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, $14, $15, $16, $17)
     ON CONFLICT (daily_date) WHERE kind = 'daily' DO NOTHING
     RETURNING id`,
    [
      job.kind,
      job.target_date,
      job.board_size,
      toPlay,
      JSON.stringify(position.input.moves),
      JSON.stringify(position.board),
      best.move,
      coordinate.x,
      coordinate.y,
      JSON.stringify(candidates.slice(0, 3).map((candidate) => ({
        move: candidate.move,
        scoreLead: candidate.scoreLead,
        winrate: candidate.winrate,
      }))),
      puzzleDifficulty(gap),
      JSON.stringify(explanation(best, second, job.board_size)),
      engineVersion,
      modelName,
      visits,
      position.sourceGameId,
      position.sourceMoveNumber,
    ],
  );
  let puzzleId = inserted.rows[0]?.id;
  if (!puzzleId && job.kind === "daily") {
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM puzzles WHERE kind = 'daily' AND daily_date = $1",
      [job.target_date],
    );
    puzzleId = existing.rows[0]?.id;
  }
  if (!puzzleId) throw new Error("Puzzle insert did not return a puzzle.");
  await client.query(
    `UPDATE puzzle_generation_jobs
        SET status = 'completed', puzzle_id = $2, completed_at = NOW(),
            lease_expires_at = NULL, worker_id = NULL, error_code = NULL,
            error_message = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'running' AND worker_id = $3`,
    [job.id, puzzleId, puzzleWorkerId],
  );
}

async function ensurePuzzleInventory(): Promise<void> {
  await withTransaction(async (client) => {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('gostone:puzzle-inventory')) AS locked",
    );
    if (!lock.rows[0]?.locked) return;
    const day = await client.query<{ today: string }>(
      "SELECT CURRENT_DATE::text AS today",
    );
    const today = day.rows[0];
    if (!today) return;
    const dailySize: BoardSize = 9;
    await client.query(
      `INSERT INTO puzzle_generation_jobs (kind, target_date, board_size)
       VALUES ('daily', $1, $2)
       ON CONFLICT (target_date) WHERE kind = 'daily' DO NOTHING`,
      [today.today, dailySize],
    );
    const inventory = await client.query<{ count: number }>(
      `SELECT (
         (SELECT COUNT(*) FROM puzzles WHERE kind = 'practice')
         + (SELECT COUNT(*) FROM puzzle_generation_jobs
             WHERE kind = 'practice' AND status IN ('queued', 'running'))
       )::int AS count`,
    );
    const missing = Math.max(0, 9 - (inventory.rows[0]?.count ?? 0));
    for (let index = 0; index < Math.min(3, missing); index += 1) {
      const size = [9, 13, 19][((inventory.rows[0]?.count ?? 0) + index) % 3] as BoardSize;
      await client.query(
        "INSERT INTO puzzle_generation_jobs (kind, board_size) VALUES ('practice', $1)",
        [size],
      );
    }
  });
}

async function claimPuzzleJob(): Promise<PuzzleJob | null> {
  const result = await query<PuzzleJob>(
    `UPDATE puzzle_generation_jobs
        SET status = 'running', attempts = attempts + 1, worker_id = $1,
            started_at = COALESCE(started_at, NOW()),
            lease_expires_at = NOW() + INTERVAL '10 minutes', updated_at = NOW()
      WHERE id = (
        SELECT id FROM puzzle_generation_jobs
         WHERE attempts < 3
           AND (status = 'queued' OR (status = 'running' AND lease_expires_at < NOW()))
         ORDER BY CASE kind WHEN 'daily' THEN 0 ELSE 1 END, created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING id, kind, target_date, board_size, attempts`,
    [puzzleWorkerId],
  );
  return result.rows[0] ?? null;
}

async function failPuzzleJob(job: PuzzleJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown puzzle generation error.";
  const finalAttempt = job.attempts >= 3;
  await query(
    `UPDATE puzzle_generation_jobs
        SET status = $2, error_code = 'katago_puzzle_failed', error_message = $3,
            lease_expires_at = NULL, worker_id = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'running' AND worker_id = $4`,
    [job.id, finalAttempt ? "failed" : "queued", message.slice(0, 1_000), puzzleWorkerId],
  );
  console.error(`Puzzle generation ${job.id} failed:`, message);
}

async function generatePuzzle(
  engine: KataGoEngine,
  job: PuzzleJob,
  visits: number,
  engineVersion: string,
  modelName: string,
): Promise<void> {
  const position = await sourceFromGame(job) ?? syntheticPosition(job);
  const analyzed = await engine.analyzeCurrent(
    `puzzle:${job.id}`,
    position.input,
    visits,
    { priority: -10 },
  );
  const candidates = [...analyzed.moveInfos]
    .filter((candidate) => candidate.move.toLowerCase() !== "pass")
    .sort((left, right) => left.order - right.order || right.visits - left.visits);
  const best = candidates[0];
  if (!best) throw new Error("KataGo returned no stone move for the puzzle.");
  const toPlay: Stone = analyzed.rootInfo.currentPlayer === "B" ? "black" : "white";
  const point = fromGtpCoordinate(job.board_size, best.move);
  if (point.x === undefined || point.y === undefined) {
    throw new Error("Puzzle answer is not a board move.");
  }
  const legal = applyMove(position.board, toPlay, point.x, point.y);
  if (!legal.ok) throw new Error(`KataGo puzzle answer is not legal (${legal.error}).`);
  await withTransaction((client) => completePuzzle(
    client,
    job,
    position,
    toPlay,
    best,
    candidates,
    visits,
    engineVersion,
    modelName,
  ));
}

export async function runPuzzleLoop(
  engine: KataGoEngine,
  state: PuzzleLoopState,
  shouldStop: () => boolean,
  options: { engineVersion: string; modelName: string },
): Promise<void> {
  const pollMs = Math.max(1_000, Number(process.env.KATAGO_PUZZLE_POLL_INTERVAL_MS) || 2_000);
  const visits = Math.max(8, Number(process.env.KATAGO_PUZZLE_MAX_VISITS) || 16);
  while (!shouldStop()) {
    await ensurePuzzleInventory();
    const job = await claimPuzzleJob();
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      continue;
    }
    state.activeJobId = job.id;
    try {
      await generatePuzzle(engine, job, visits, options.engineVersion, options.modelName);
      console.log(`Puzzle ${job.id} generated.`);
    } catch (error) {
      await failPuzzleJob(job, error);
    } finally {
      state.activeJobId = null;
    }
  }
}
