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
import { applyMove, countLiberties, createEmptyBoard, getGroup, replayMoves } from "@/lib/game/goEngine";
import type { Board, BoardSize, Stone, StoredMove } from "@/lib/game/types";
import {
  PUZZLE_CATEGORIES,
  PUZZLE_KYU_LADDER,
  PUZZLES_PER_CATEGORY,
  type PuzzleCategory,
  type PuzzleDifficulty,
  type PuzzleKind,
  type PuzzlePly,
  type PuzzleVariation,
} from "@/lib/puzzles/types";
import { curatedPuzzle } from "@/lib/puzzles/curatedCatalog";
import type { KataGoEngine } from "./engine";

type PuzzleJob = {
  id: string;
  kind: PuzzleKind;
  target_date: string | Date | null;
  board_size: BoardSize;
  category: PuzzleCategory | null;
  rank_kyu: number | null;
  collection_order: number | null;
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
  sourceCandidates?: string[];
  localMoves?: string[];
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

function categoryPosition(job: PuzzleJob): PuzzlePosition {
  if (!job.category || !job.collection_order) {
    throw new Error("Categorized puzzle job is incomplete.");
  }
  if (job.board_size !== 13) throw new Error("Curated puzzles require a 13x13 board.");
  const curated = curatedPuzzle(job.category, job.collection_order);
  const board = curated.board;
  const visited = new Set<string>();
  for (let y = 0; y < job.board_size; y += 1) {
    for (let x = 0; x < job.board_size; x += 1) {
      if (board[y][x] === null || visited.has(`${x}:${y}`)) continue;
      const group = getGroup(board, { x, y });
      for (const point of group) visited.add(`${point.x}:${point.y}`);
      if (countLiberties(board, group) === 0) {
        throw new Error("Curated puzzle contains a group without liberties.");
      }
    }
  }
  const initialStones: AnalysisMove[] = [];
  for (let y = 0; y < job.board_size; y += 1) {
    for (let x = 0; x < job.board_size; x += 1) {
      const color = board[y][x];
      if (!color) continue;
      initialStones.push({
        color,
        move: toGtpCoordinate(job.board_size, { x, y, isPass: false }),
      });
    }
  }
  return {
    input: {
      contractVersion: ANALYSIS_ENGINE_CONTRACT_VERSION,
      gameId: `puzzle-category:${curated.sourceId}`,
      gameVersion: 0,
      boardSize: job.board_size,
      komi: 7.5,
      rules: "chinese",
      initialStones,
      initialPlayer: "black",
      moves: [],
    },
    board,
    sourceGameId: null,
    sourceMoveNumber: 0,
    sourceCandidates: curated.candidateMoves.map((point) => toGtpCoordinate(13, { ...point, isPass: false })),
    localMoves: curated.localRegion
      .filter((point) => board[point.y][point.x] === null)
      .map((point) => toGtpCoordinate(13, { ...point, isPass: false })),
  };
}

function syntheticPosition(job: PuzzleJob): PuzzlePosition {
  if (job.category) return categoryPosition(job);
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
  if (gap < 0.05) {
    return {
      en: `KataGo prefers ${best.move} in the ${regionEn}. The point difference is close, but this move preserves the strongest local continuation and the most reliable shape.`,
      de: `KataGo bevorzugt ${best.move} in der ${regionDe}. Der Punktunterschied ist knapp, aber dieser Zug bewahrt die stärkste lokale Fortsetzung und die verlässlichste Form.`,
    };
  }
  return {
    en: `KataGo prefers ${best.move} in the ${regionEn}. It keeps about ${points} more points than the closest analyzed alternative while preserving the strongest continuation.`,
    de: `KataGo bevorzugt ${best.move} in der ${regionDe}. Der Zug bewahrt ungefähr ${points} Punkte mehr als die nächstbeste untersuchte Alternative und hält die stärkste Fortsetzung offen.`,
  };
}

function catalogDifficulty(rankKyu: number | null, gap: number): PuzzleDifficulty {
  if (rankKyu === null) return puzzleDifficulty(gap);
  if (rankKyu >= 24) return "beginner";
  if (rankKyu >= 18) return "intermediate";
  return "advanced";
}

function opposite(color: Stone): Stone {
  return color === "black" ? "white" : "black";
}

function lineFromCandidate(
  board: Board,
  toPlay: Stone,
  candidate: KataGoMoveInfo,
  boardSize: BoardSize,
  maximumPlies: number,
): PuzzlePly[] {
  const pv = candidate.pv[0]?.toLowerCase() === candidate.move.toLowerCase()
    ? candidate.pv
    : [candidate.move, ...candidate.pv];
  const line: PuzzlePly[] = [];
  let currentBoard = board;
  let color = toPlay;
  for (const move of pv.slice(0, maximumPlies)) {
    if (move.toLowerCase() === "pass") break;
    const point = fromGtpCoordinate(boardSize, move);
    if (point.x === undefined || point.y === undefined) break;
    const applied = applyMove(currentBoard, color, point.x, point.y);
    if (!applied.ok) break;
    line.push({ color, move, x: point.x, y: point.y });
    currentBoard = applied.board;
    color = opposite(color);
  }
  return line;
}

function categoryExplanation(
  category: PuzzleCategory,
  userMove: string,
  reply: string | null,
) {
  const responseEn = reply ? ` After ${userMove}, ${reply} is the forcing reply.` : "";
  const responseDe = reply ? ` Nach ${userMove} ist ${reply} die zwingende Antwort.` : "";
  const copy = {
    life_and_death: {
      en: "This route misses the vital point that decides the group's eye space.",
      de: "Diese Variante verpasst den vitalen Punkt, der über den Augenraum der Gruppe entscheidet.",
    },
    tesuji: {
      en: "This move loses the forcing order; the opponent can answer efficiently and keep the shape connected.",
      de: "Dieser Zug verliert die zwingende Reihenfolge; der Gegner kann effizient antworten und seine Form verbinden.",
    },
    capturing_race: {
      en: "This route falls behind in the liberty race and lets the opponent take the key shared liberty.",
      de: "Diese Variante verliert im Freiheitsrennen ein Tempo und überlässt dem Gegner die entscheidende gemeinsame Freiheit.",
    },
    endgame: {
      en: "This route gives up endgame value or sente, so the opponent can take the larger follow-up.",
      de: "Diese Variante verschenkt Endspielwert oder Sente, sodass der Gegner die größere Fortsetzung erhält.",
    },
  }[category];
  return { en: `${copy.en}${responseEn}`, de: `${copy.de}${responseDe}` };
}

function buildVariation(
  job: PuzzleJob,
  board: Board,
  toPlay: Stone,
  candidates: readonly KataGoMoveInfo[],
  mainLineOverride?: PuzzlePly[],
  acceptedMoves: readonly string[] = [],
): PuzzleVariation | null {
  if (!job.category) return null;
  const best = candidates[0];
  if (!best) return null;
  const mainLine = mainLineOverride ?? lineFromCandidate(board, toPlay, best, job.board_size, 5);
  if (mainLine.length < 3) {
    throw new Error("KataGo did not return a long enough training variation.");
  }
  const accepted = new Set(acceptedMoves.map((move) => move.toLowerCase()));
  const refutations = candidates.slice(0, 8).flatMap((candidate) => {
    if (accepted.has(candidate.move.toLowerCase())) return [];
    const line = lineFromCandidate(board, toPlay, candidate, job.board_size, 2);
    const userMove = line[0];
    if (!userMove) return [];
    const reply = line[1] ?? null;
    return [{
      userMove,
      reply,
      explanation: categoryExplanation(job.category!, userMove.move, reply?.move ?? null),
    }];
  });
  return {
    version: 1,
    mainLine,
    refutations,
    fallbackExplanation: categoryExplanation(job.category, "this move", null),
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
  variationOverride?: PuzzleVariation | null,
): Promise<void> {
  const coordinate = fromGtpCoordinate(job.board_size, best.move);
  if (coordinate.x === undefined || coordinate.y === undefined) {
    throw new Error("KataGo puzzle solution must place a stone.");
  }
  const second = candidates[1];
  const gap = second ? Math.max(0, best.scoreLead - second.scoreLead) : 0;
  const variation = variationOverride === undefined
    ? buildVariation(job, position.board, toPlay, candidates)
    : variationOverride;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO puzzles (
       kind, daily_date, board_size, to_play, position_moves, board,
       solution_move, solution_x, solution_y, alternatives, difficulty,
       explanation, engine_version, model_name, visits,
       source_game_id, source_move_number, category, rank_kyu,
       collection_order, variation
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb,
             $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, $14, $15,
             $16, $17, $18, $19, $20, $21::jsonb)
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
      catalogDifficulty(job.rank_kyu, gap),
      JSON.stringify(explanation(best, second, job.board_size)),
      engineVersion,
      modelName,
      visits,
      position.sourceGameId,
      position.sourceMoveNumber,
      job.category,
      job.rank_kyu,
      job.collection_order,
      variation ? JSON.stringify(variation) : null,
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
    const categories: PuzzleCategory[] = [];
    const ranks: number[] = [];
    const orders: number[] = [];
    for (const category of PUZZLE_CATEGORIES) {
      for (let index = 0; index < PUZZLES_PER_CATEGORY; index += 1) {
        categories.push(category);
        ranks.push(PUZZLE_KYU_LADDER[index] ?? 15);
        orders.push(index + 1);
      }
    }
    await client.query(
      `INSERT INTO puzzle_generation_jobs (
         kind, board_size, category, rank_kyu, collection_order
       )
       SELECT 'practice', 13, catalog.category, catalog.rank_kyu, catalog.collection_order
         FROM UNNEST($1::text[], $2::int[], $3::int[])
           AS catalog(category, rank_kyu, collection_order)
       ON CONFLICT (category, collection_order)
         WHERE kind = 'practice' AND category IS NOT NULL
       DO NOTHING`,
      [categories, ranks, orders],
    );
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
         ORDER BY CASE kind WHEN 'daily' THEN 0 ELSE 1 END,
                  collection_order NULLS FIRST, category NULLS FIRST, created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING id, kind, target_date, board_size, category,
                rank_kyu, collection_order, attempts`,
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

function sortedStoneCandidates(result: Awaited<ReturnType<KataGoEngine["analyzeCurrent"]>>) {
  return [...result.moveInfos]
    .filter((candidate) => candidate.move.toLowerCase() !== "pass")
    .sort((left, right) => left.order - right.order || right.visits - left.visits);
}

async function analyzeCuratedPuzzle(
  engine: KataGoEngine,
  job: PuzzleJob,
  position: PuzzlePosition,
  visits: number,
): Promise<{ best: KataGoMoveInfo; candidates: KataGoMoveInfo[]; variation: PuzzleVariation }> {
  const solutions = position.sourceCandidates;
  const localMoves = position.localMoves;
  if (!job.category || !solutions?.length || !localMoves?.length) {
    throw new Error("Curated puzzle metadata is incomplete.");
  }
  const localAnalysis = await engine.analyzeCurrent(
    `puzzle:${job.id}:local`,
    {
      ...position.input,
      allowMoves: [
        { player: "black", moves: localMoves, untilDepth: 3 },
        { player: "white", moves: localMoves, untilDepth: 3 },
      ],
    },
    visits,
    { priority: -10 },
  );
  const localCandidates = sortedStoneCandidates(localAnalysis);
  const accepted = new Set(solutions.map((move) => move.toLowerCase()));
  let best = localCandidates.find((candidate) => accepted.has(candidate.move.toLowerCase()));
  let mainLine = best
    ? lineFromCandidate(position.board, "black", best, job.board_size, 3)
    : [];

  if (!best || mainLine.length < 3) {
    const forced = await engine.analyzeCurrent(
      `puzzle:${job.id}:forced`,
      {
        ...position.input,
        allowMoves: [
          { player: "black", moves: solutions, untilDepth: 1 },
          { player: "white", moves: localMoves, untilDepth: 2 },
        ],
      },
      visits,
      { priority: -10 },
    );
    const forcedCandidates = sortedStoneCandidates(forced);
    best = forcedCandidates.find((candidate) => accepted.has(candidate.move.toLowerCase()));
    if (!best) throw new Error("KataGo did not select a source-marked candidate move.");
    mainLine = lineFromCandidate(position.board, "black", best, job.board_size, 2);
  }

  let lineBoard = position.board;
  for (const ply of mainLine) {
    const applied = applyMove(lineBoard, ply.color, ply.x, ply.y);
    if (!applied.ok) throw new Error(`Curated main line is illegal (${applied.error}).`);
    lineBoard = applied.board;
  }
  while (mainLine.length < 3) {
    const color: Stone = mainLine.length % 2 === 0 ? "black" : "white";
    const available = localMoves.filter((move) => {
      const point = fromGtpCoordinate(job.board_size, move);
      return point.x !== undefined
        && point.y !== undefined
        && applyMove(lineBoard, color, point.x, point.y).ok;
    });
    if (!available.length) throw new Error("Curated puzzle has no local continuation.");
    const continued = await engine.analyzeCurrent(
      `puzzle:${job.id}:continuation:${mainLine.length}`,
      {
        ...position.input,
        moves: [
          ...position.input.moves,
          ...mainLine.map((ply) => ({ color: ply.color, move: ply.move })),
        ],
        allowMoves: [{ player: color, moves: available, untilDepth: 1 }],
      },
      visits,
      { priority: -10 },
    );
    const next = sortedStoneCandidates(continued)[0];
    if (!next) throw new Error("KataGo returned no local continuation.");
    const added = lineFromCandidate(lineBoard, color, next, job.board_size, 1)[0];
    if (!added) throw new Error("KataGo returned an illegal local continuation.");
    mainLine.push(added);
    const applied = applyMove(lineBoard, added.color, added.x, added.y);
    if (!applied.ok) throw new Error(`Curated continuation is illegal (${applied.error}).`);
    lineBoard = applied.board;
  }

  if (!best) throw new Error("Curated puzzle has no validated solution candidate.");
  const candidates = [best, ...localCandidates.filter(
    (candidate) => candidate.move.toLowerCase() !== best!.move.toLowerCase(),
  )];
  const variation = buildVariation(
    job,
    position.board,
    "black",
    candidates,
    mainLine.slice(0, 3),
    [best.move],
  );
  if (!variation) throw new Error("Curated variation could not be created.");
  return { best, candidates, variation };
}

async function generatePuzzle(
  engine: KataGoEngine,
  job: PuzzleJob,
  visits: number,
  engineVersion: string,
  modelName: string,
): Promise<void> {
  const position = job.category
    ? syntheticPosition(job)
    : await sourceFromGame(job) ?? syntheticPosition(job);
  if (job.category) {
    const curated = await analyzeCuratedPuzzle(engine, job, position, visits);
    const point = fromGtpCoordinate(job.board_size, curated.best.move);
    if (point.x === undefined || point.y === undefined) {
      throw new Error("Curated puzzle answer is not a board move.");
    }
    const legal = applyMove(position.board, "black", point.x, point.y);
    if (!legal.ok) throw new Error(`Curated puzzle answer is not legal (${legal.error}).`);
    await withTransaction((client) => completePuzzle(
      client,
      job,
      position,
      "black",
      curated.best,
      curated.candidates,
      visits,
      engineVersion,
      modelName,
      curated.variation,
    ));
    return;
  }
  const analyzed = await engine.analyzeCurrent(
    `puzzle:${job.id}`,
    position.input,
    visits,
    { priority: -10 },
  );
  const candidates = sortedStoneCandidates(analyzed);
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
  const visits = Math.max(8, Number(process.env.KATAGO_PUZZLE_MAX_VISITS) || 8);
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
