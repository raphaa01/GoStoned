import type { PoolClient, QueryResultRow } from "pg";
import { query, withTransaction } from "@/lib/db";
import {
  applyMove,
  boardHash,
  createEmptyBoard,
  getGroup,
  replayMoves,
  scoreChinese,
} from "./goEngine";
import { advanceClock, restingClock, type ClockAdvance } from "./goClock";
import {
  resumeTurnForClaim,
  scoreChineseAgreement,
  scoringDeadlineExpired,
  toggleDeadGroup,
} from "./scoring";
import type {
  Board,
  BoardSize,
  GameState,
  Position,
  Score,
  Stone,
  StoredMove,
  TimeControlId,
} from "./types";

type GameRow = {
  id: string;
  board_size: BoardSize;
  black_player_key: string;
  white_player_key: string;
  black_player_name: string;
  white_player_name: string;
  winner_key: string | null;
  status: "active" | "finished";
  phase: "play" | "scoring";
  to_move: Stone | null;
  consecutive_passes: number;
  scoring_revision: number;
  result: string | null;
  finish_reason: "score" | "resignation" | "timeout" | "legacy_score" | null;
  last_resume_claim: "dead" | "alive" | "deadline" | null;
  last_resume_by: Stone | null;
  last_resume_x: number | null;
  last_resume_y: number | null;
  komi: string | number;
  rules: "chinese";
  rules_profile: "legacy-immediate-area" | "chinese-2002-gostone-v1";
  scoring_method: "area";
  handicap: number;
  time_control: TimeControlId;
  main_time_seconds: number;
  byo_yomi_periods: number;
  byo_yomi_seconds: number;
  black_time_remaining_ms: string | number;
  white_time_remaining_ms: string | number;
  black_periods_remaining: number;
  white_periods_remaining: number;
  turn_started_at: Date;
  version: number;
  started_at: Date;
  finished_at: Date | null;
};

type MoveRow = {
  move_number: number;
  color: Stone;
  x: number | null;
  y: number | null;
  is_pass: boolean;
  board_hash: string | null;
  created_at: Date;
};

type ScoringRow = {
  game_id: string;
  board_hash: string;
  stopped_move_number: number;
  revision: number;
  rules: "chinese";
  rules_profile: "chinese-2002-gostone-v1";
  scoring_method: "area";
  komi: string | number;
  handicap: number;
  fallback_to_move: Stone;
  expires_at: Date;
  black_confirmed_revision: number | null;
  white_confirmed_revision: number | null;
  black_confirmed_at: Date | null;
  white_confirmed_at: Date | null;
  scored_board_hash: string | null;
  black_stones: number | null;
  white_stones: number | null;
  black_territory: number | null;
  white_territory: number | null;
  neutral_points: number | null;
  black_dead_stones: number | null;
  white_dead_stones: number | null;
  black_total: string | number | null;
  white_total: string | number | null;
  result: string | null;
  started_at: Date;
  updated_at: Date;
  finalized_at: Date | null;
};

type DeadStoneRow = Position & {
  color: Stone;
};

type LoadedGame = {
  game: GameRow;
  moveRows: MoveRow[];
  scoring: ScoringRow | null;
  deadRows: DeadStoneRow[];
};

const SCORING_RESPONSE_WINDOW_MS = 10 * 60 * 1_000;

export class GameServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

function assertParticipant(game: GameRow, playerKey: string) {
  if (playerKey !== game.black_player_key && playerKey !== game.white_player_key) {
    throw new GameServiceError("You are not a participant in this game.", 403, "not_participant");
  }
}

function playerColor(game: GameRow, playerKey: string): Stone {
  return playerKey === game.black_player_key ? "black" : "white";
}

function opposite(color: Stone): Stone {
  return color === "black" ? "white" : "black";
}

function mapMoves(rows: MoveRow[]): StoredMove[] {
  return rows.map((move) => ({
    moveNumber: move.move_number,
    color: move.color,
    x: move.x,
    y: move.y,
    isPass: move.is_pass,
    createdAt: move.created_at.toISOString(),
  }));
}

async function loadGame(
  client: PoolClient | null,
  gameId: string,
  lock = false,
): Promise<LoadedGame> {
  const execute = <T extends QueryResultRow>(text: string, values: readonly unknown[]) =>
    client ? client.query<T>(text, [...values]) : query<T>(text, values);
  const gameResult = await execute<GameRow>(
    `SELECT g.id, g.board_size, g.black_player_key, g.white_player_key, g.winner_key,
            g.status, g.phase, g.to_move, g.consecutive_passes, g.scoring_revision,
            g.result, g.finish_reason, g.last_resume_claim, g.last_resume_by,
            g.last_resume_x, g.last_resume_y, g.komi, g.rules, g.rules_profile,
            g.scoring_method, g.handicap, g.time_control, g.main_time_seconds,
            g.byo_yomi_periods, g.byo_yomi_seconds,
            g.black_time_remaining_ms, g.white_time_remaining_ms,
            g.black_periods_remaining, g.white_periods_remaining,
            g.turn_started_at, g.version, g.started_at, g.finished_at,
            COALESCE(
              NULLIF(BTRIM(black_user.display_name), ''),
              black_user.username,
              'Guest ' || UPPER(RIGHT(g.black_player_key, 6))
            ) AS black_player_name,
            COALESCE(
              NULLIF(BTRIM(white_user.display_name), ''),
              white_user.username,
              'Guest ' || UPPER(RIGHT(g.white_player_key, 6))
            ) AS white_player_name
       FROM games g
       LEFT JOIN users black_user
         ON g.black_player_key = 'user:' || black_user.id::text
       LEFT JOIN users white_user
         ON g.white_player_key = 'user:' || white_user.id::text
      WHERE g.id = $1${lock ? " FOR UPDATE OF g" : ""}`,
    [gameId],
  );
  const game = gameResult.rows[0];
  if (!game) throw new GameServiceError("Game not found.", 404, "game_not_found");

  const movesResult = await execute<MoveRow>(
    `SELECT move_number, color, x, y, is_pass, board_hash, created_at
       FROM moves
      WHERE game_id = $1
      ORDER BY move_number`,
    [gameId],
  );

  let scoring: ScoringRow | null = null;
  let deadRows: DeadStoneRow[] = [];
  if (game.phase === "scoring" || game.finish_reason === "score") {
    const scoringResult = await execute<ScoringRow>(
      `SELECT * FROM game_scoring_state WHERE game_id = $1${lock ? " FOR UPDATE" : ""}`,
      [gameId],
    );
    scoring = scoringResult.rows[0] ?? null;
    if (scoring) {
      const deadResult = await execute<DeadStoneRow>(
        `SELECT x, y, color
           FROM game_dead_stones
          WHERE game_id = $1
          ORDER BY y, x`,
        [gameId],
      );
      deadRows = deadResult.rows;
    }
  }

  return { game, moveRows: movesResult.rows, scoring, deadRows };
}

function currentTurn(game: GameRow, moveRows: MoveRow[]): Stone | null {
  if (game.status !== "active" || game.phase !== "play") return null;
  // Migration 008 is a schema-first expand step. The previous application
  // does not maintain to_move, so a legacy game remains move-log-authoritative
  // even if it was active during the deployment window.
  if (game.rules_profile === "legacy-immediate-area") {
    return moveRows.length % 2 === 0 ? "black" : "white";
  }
  return game.to_move;
}

function effectiveConsecutivePasses(game: GameRow, moveRows: MoveRow[]): number {
  if (game.rules_profile !== "legacy-immediate-area") return game.consecutive_passes;
  return moveRows.at(-1)?.is_pass ? 1 : 0;
}

function calculateClocks(
  game: GameRow,
  turn: Stone | null,
  now: Date,
): { black: ClockAdvance; white: ClockAdvance } {
  const periodTimeMs = game.byo_yomi_seconds * 1_000;
  const elapsedMs = Math.max(0, now.getTime() - game.turn_started_at.getTime());
  const blackInput = {
    mainTimeMs: Number(game.black_time_remaining_ms),
    periodsRemaining: game.black_periods_remaining,
    periodTimeMs,
  };
  const whiteInput = {
    mainTimeMs: Number(game.white_time_remaining_ms),
    periodsRemaining: game.white_periods_remaining,
    periodTimeMs,
  };
  return {
    black: turn === "black"
      ? advanceClock({ ...blackInput, elapsedMs })
      : restingClock(blackInput.mainTimeMs, blackInput.periodsRemaining, blackInput.periodTimeMs),
    white: turn === "white"
      ? advanceClock({ ...whiteInput, elapsedMs })
      : restingClock(whiteInput.mainTimeMs, whiteInput.periodsRemaining, whiteInput.periodTimeMs),
  };
}

function storedFinalScore(scoring: ScoringRow): Score | null {
  if (scoring.finalized_at === null || scoring.black_total === null || scoring.white_total === null) {
    return null;
  }
  const black = Number(scoring.black_total);
  const white = Number(scoring.white_total);
  return {
    black,
    white,
    blackStones: scoring.black_stones ?? 0,
    whiteStones: scoring.white_stones ?? 0,
    blackTerritory: scoring.black_territory ?? 0,
    whiteTerritory: scoring.white_territory ?? 0,
    neutralPoints: scoring.neutral_points ?? 0,
    winner: black === white ? null : black > white ? "black" : "white",
    margin: Math.abs(black - white),
    result: scoring.result ?? "Draw",
  };
}

function serializeGame(loaded: LoadedGame, now = new Date()): GameState {
  const { game, moveRows, scoring, deadRows } = loaded;
  const moves = mapMoves(moveRows);
  const turn = currentTurn(game, moveRows);
  const clocks = calculateClocks(game, turn, now);
  const board = replayMoves(game.board_size, moves);
  const deadStones = deadRows.map(({ x, y }) => ({ x, y }));
  const preview = scoring
    ? storedFinalScore(scoring) ?? scoreChineseAgreement(board, deadStones, Number(scoring.komi))
    : null;
  return {
    id: game.id,
    boardSize: game.board_size,
    blackPlayerKey: game.black_player_key,
    whitePlayerKey: game.white_player_key,
    blackPlayerName: game.black_player_name,
    whitePlayerName: game.white_player_name,
    winnerKey: game.winner_key,
    status: game.status,
    phase: game.phase,
    result: game.result,
    finishReason: game.finish_reason,
    komi: Number(game.komi),
    ruleset: game.rules,
    rulesProfile: game.rules_profile,
    scoringMethod: game.scoring_method,
    handicap: game.handicap,
    consecutivePasses: effectiveConsecutivePasses(game, moveRows),
    scoringRevision: game.scoring_revision,
    lastResume: game.last_resume_claim ? {
      claim: game.last_resume_claim,
      requestedBy: game.last_resume_by,
      disputedStone: game.last_resume_x === null || game.last_resume_y === null
        ? null
        : { x: game.last_resume_x, y: game.last_resume_y },
    } : null,
    scoring: scoring ? {
      revision: scoring.revision,
      boardHash: scoring.board_hash,
      stoppedMoveNumber: scoring.stopped_move_number,
      deadStones,
      blackConfirmed: scoring.black_confirmed_revision === scoring.revision,
      whiteConfirmed: scoring.white_confirmed_revision === scoring.revision,
      preview: preview!,
      finalizedAt: scoring.finalized_at?.toISOString() ?? null,
      expiresAt: scoring.expires_at.toISOString(),
    } : null,
    version: game.version,
    startedAt: game.started_at.toISOString(),
    finishedAt: game.finished_at?.toISOString() ?? null,
    timeControl: game.time_control,
    clock: {
      serverNow: now.toISOString(),
      mainTimeSeconds: game.main_time_seconds,
      byoYomiPeriods: game.byo_yomi_periods,
      byoYomiSeconds: game.byo_yomi_seconds,
      black: {
        mainTimeMs: clocks.black.mainTimeMs,
        periodsRemaining: clocks.black.periodsRemaining,
        displayTimeMs: clocks.black.displayTimeMs,
        phase: clocks.black.phase,
      },
      white: {
        mainTimeMs: clocks.white.mainTimeMs,
        periodsRemaining: clocks.white.periodsRemaining,
        displayTimeMs: clocks.white.displayTimeMs,
        phase: clocks.white.phase,
      },
    },
    turn,
    moveCount: moves.length,
    board,
    moves,
  };
}

function withUpdatedGame(loaded: LoadedGame, row: GameRow): LoadedGame {
  return {
    ...loaded,
    game: {
      ...row,
      black_player_name: loaded.game.black_player_name,
      white_player_name: loaded.game.white_player_name,
    },
  };
}

async function recordFinishedStats(
  client: PoolClient,
  game: GameRow,
  winnerKey: string | null,
) {
  for (const playerKey of [game.black_player_key, game.white_player_key].sort()) {
    const won = winnerKey === playerKey;
    const draw = winnerKey === null;
    const ratingDelta = draw ? 0 : won ? 16 : -16;
    await client.query(
      `INSERT INTO player_stats (player_key, board_size)
       VALUES ($1, $2)
       ON CONFLICT (player_key, board_size) DO NOTHING`,
      [playerKey, game.board_size],
    );
    const current = await client.query<{ rating: number }>(
      `SELECT rating
         FROM player_stats
        WHERE player_key = $1 AND board_size = $2
        FOR UPDATE`,
      [playerKey, game.board_size],
    );
    const ratingBefore = current.rows[0].rating;
    const ratingAfter = Math.max(100, ratingBefore + ratingDelta);
    const ledger = await client.query<{ id: string }>(
      `INSERT INTO player_rating_history
         (player_key, game_id, board_size, rating_before, rating_after,
          rating_change, result, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
       ON CONFLICT (player_key, game_id) DO NOTHING
       RETURNING id`,
      [
        playerKey,
        game.id,
        game.board_size,
        ratingBefore,
        ratingAfter,
        ratingAfter - ratingBefore,
        draw ? "draw" : won ? "win" : "loss",
        game.finished_at,
      ],
    );
    if (ledger.rowCount === 0) continue;
    await client.query(
      `UPDATE player_stats
          SET games = games + 1,
              wins = wins + $3,
              losses = losses + $4,
              draws = draws + $5,
              rating = $6,
              highest_rating = GREATEST(highest_rating, $6),
              updated_at = NOW()
        WHERE player_key = $1 AND board_size = $2`,
      [
        playerKey,
        game.board_size,
        won ? 1 : 0,
        !won && !draw ? 1 : 0,
        draw ? 1 : 0,
        ratingAfter,
      ],
    );
  }
}

async function finishOnTime(
  client: PoolClient,
  loaded: LoadedGame,
  timedOutColor: Stone,
  now: Date,
): Promise<GameState> {
  const { game } = loaded;
  const winnerKey = timedOutColor === "black" ? game.white_player_key : game.black_player_key;
  const winnerColor = timedOutColor === "black" ? "W" : "B";
  const updated = await client.query<GameRow>(
    `UPDATE games
        SET status = 'finished', phase = 'play', to_move = NULL,
            finish_reason = 'timeout', result = $2, winner_key = $3,
            black_time_remaining_ms = CASE WHEN $4 = 'black' THEN 0 ELSE black_time_remaining_ms END,
            white_time_remaining_ms = CASE WHEN $4 = 'white' THEN 0 ELSE white_time_remaining_ms END,
            black_periods_remaining = CASE WHEN $4 = 'black' THEN 0 ELSE black_periods_remaining END,
            white_periods_remaining = CASE WHEN $4 = 'white' THEN 0 ELSE white_periods_remaining END,
            finished_at = $5, updated_at = $5, version = version + 1
      WHERE id = $1
      RETURNING *`,
    [game.id, `${winnerColor}+T`, winnerKey, timedOutColor, now],
  );
  const nextLoaded = withUpdatedGame(loaded, updated.rows[0]);
  await recordFinishedStats(client, nextLoaded.game, winnerKey);
  return serializeGame(nextLoaded, now);
}

function assertScoringPhase(loaded: LoadedGame, expectedRevision: number): ScoringRow {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new GameServiceError("A valid scoring revision is required.", 400, "invalid_scoring_revision");
  }
  if (loaded.game.status !== "active" || loaded.game.phase !== "scoring" || !loaded.scoring) {
    throw new GameServiceError("This game is not in scoring.", 409, "not_scoring");
  }
  if (
    loaded.game.scoring_revision !== expectedRevision
    || loaded.scoring.revision !== expectedRevision
  ) {
    throw new GameServiceError(
      "The scoring proposal changed. Review the latest position.",
      409,
      "scoring_revision_conflict",
    );
  }
  return loaded.scoring;
}

async function resumeExpiredScoring(
  client: PoolClient,
  loaded: LoadedGame,
  now: Date,
): Promise<LoadedGame | null> {
  if (
    loaded.game.status !== "active"
    || loaded.game.phase !== "scoring"
    || !loaded.scoring
    || !scoringDeadlineExpired(loaded.scoring.expires_at, now)
  ) {
    return null;
  }
  await client.query("DELETE FROM game_scoring_state WHERE game_id = $1", [loaded.game.id]);
  const updated = await client.query<GameRow>(
    `UPDATE games
        SET phase = 'play', to_move = $2, consecutive_passes = 0,
            scoring_revision = scoring_revision + 1,
            last_resume_claim = 'deadline', last_resume_by = NULL,
            last_resume_x = NULL, last_resume_y = NULL,
            turn_started_at = $3, updated_at = $3, version = version + 1
      WHERE id = $1
      RETURNING *`,
    [loaded.game.id, loaded.scoring.fallback_to_move, now],
  );
  return {
    ...withUpdatedGame(loaded, updated.rows[0]),
    scoring: null,
    deadRows: [],
  };
}

function stoppedBoard(loaded: LoadedGame, scoring: ScoringRow): Board {
  const moves = mapMoves(loaded.moveRows).slice(0, scoring.stopped_move_number);
  const board = replayMoves(loaded.game.board_size, moves);
  if (boardHash(board) !== scoring.board_hash) {
    throw new GameServiceError(
      "The stored scoring position could not be verified.",
      500,
      "scoring_snapshot_mismatch",
    );
  }
  return board;
}

export async function getGameState(gameId: string, playerKey: string): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadGame(client, gameId, true);
    assertParticipant(loaded.game, playerKey);
    const now = new Date();
    const resumed = await resumeExpiredScoring(client, loaded, now);
    if (resumed) return serializeGame(resumed, now);
    const turn = currentTurn(loaded.game, loaded.moveRows);
    if (turn) {
      const clocks = calculateClocks(loaded.game, turn, now);
      if (clocks[turn].timedOut) return finishOnTime(client, loaded, turn, now);
    }
    return serializeGame(loaded, now);
  });
}

export async function submitMove(
  gameId: string,
  playerKey: string,
  move: { x?: number; y?: number; isPass?: boolean },
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadGame(client, gameId, true);
    assertParticipant(loaded.game, playerKey);
    const resumed = await resumeExpiredScoring(client, loaded, new Date());
    if (resumed) return serializeGame(resumed);
    const { game, moveRows } = loaded;
    if (game.status !== "active") {
      throw new GameServiceError("This game is already finished.", 409, "game_finished");
    }
    const color = currentTurn(game, moveRows);
    if (game.phase !== "play" || !color) {
      throw new GameServiceError("Agree on the score or resume play first.", 409, "game_in_scoring");
    }
    const expectedPlayer = color === "black" ? game.black_player_key : game.white_player_key;
    if (playerKey !== expectedPlayer) {
      throw new GameServiceError("It is not your turn.", 409, "not_your_turn");
    }

    const now = new Date();
    const clocks = calculateClocks(game, color, now);
    const playerClock = clocks[color];
    if (playerClock.timedOut) return finishOnTime(client, loaded, color, now);

    const currentBoard = replayMoves(game.board_size, mapMoves(moveRows));
    const isPass = move.isPass === true;
    let nextHash = boardHash(currentBoard);
    if (!isPass) {
      if (!Number.isInteger(move.x) || !Number.isInteger(move.y)) {
        throw new GameServiceError("A move needs integer x and y coordinates.", 400, "invalid_move");
      }
      const result = applyMove(currentBoard, color, move.x!, move.y!);
      if (!result.ok) {
        throw new GameServiceError(`Illegal move: ${result.error}.`, 409, result.error);
      }
      nextHash = boardHash(result.board);
      const previousHashes = new Set([
        boardHash(createEmptyBoard(game.board_size)),
        ...moveRows.filter((row) => !row.is_pass && row.board_hash).map((row) => row.board_hash!),
      ]);
      if (previousHashes.has(nextHash)) {
        throw new GameServiceError(
          "Illegal move: this position repeats an earlier board.",
          409,
          "ko",
        );
      }
    }

    const nextMoveNumber = moveRows.length + 1;
    const inserted = await client.query<MoveRow>(
      `INSERT INTO moves (game_id, move_number, color, x, y, is_pass, board_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING move_number, color, x, y, is_pass, board_hash, created_at`,
      [game.id, nextMoveNumber, color, isPass ? null : move.x, isPass ? null : move.y, isPass, nextHash],
    );
    moveRows.push(inserted.rows[0]);
    const previousPasses = effectiveConsecutivePasses(game, moveRows.slice(0, -1));
    const consecutivePasses = isPass ? previousPasses + 1 : 0;

    if (consecutivePasses >= 2) {
      if (game.rules_profile === "legacy-immediate-area") {
        const score = scoreChinese(currentBoard, Number(game.komi));
        const winnerKey = score.winner === "black"
          ? game.black_player_key
          : score.winner === "white"
            ? game.white_player_key
            : null;
        const updated = await client.query<GameRow>(
          `UPDATE games
              SET status = 'finished', phase = 'play', to_move = NULL,
                  consecutive_passes = 2, finish_reason = 'legacy_score',
                  result = $2, winner_key = $3,
                  black_time_remaining_ms = $4, white_time_remaining_ms = $5,
                  black_periods_remaining = $6, white_periods_remaining = $7,
                  finished_at = $8, updated_at = $8, version = version + 1
            WHERE id = $1
            RETURNING *`,
          [
            game.id,
            score.result,
            winnerKey,
            color === "black" ? playerClock.mainTimeMs : Number(game.black_time_remaining_ms),
            color === "white" ? playerClock.mainTimeMs : Number(game.white_time_remaining_ms),
            color === "black" ? playerClock.periodsRemaining : game.black_periods_remaining,
            color === "white" ? playerClock.periodsRemaining : game.white_periods_remaining,
            now,
          ],
        );
        const legacyLoaded = withUpdatedGame(loaded, updated.rows[0]);
        await recordFinishedStats(client, legacyLoaded.game, winnerKey);
        return serializeGame(legacyLoaded, now);
      }
      const revision = game.scoring_revision + 1;
      await client.query(
        `INSERT INTO game_scoring_state (
           game_id, board_hash, stopped_move_number, revision, rules,
           rules_profile, scoring_method, komi, handicap,
           fallback_to_move, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          game.id,
          nextHash,
          nextMoveNumber,
          revision,
          game.rules,
          game.rules_profile,
          game.scoring_method,
          game.komi,
          game.handicap,
          opposite(color),
          new Date(now.getTime() + SCORING_RESPONSE_WINDOW_MS),
        ],
      );
      const updated = await client.query<GameRow>(
        `UPDATE games
            SET phase = 'scoring', to_move = NULL, consecutive_passes = 2,
                scoring_revision = $2,
                black_time_remaining_ms = $3, white_time_remaining_ms = $4,
                black_periods_remaining = $5, white_periods_remaining = $6,
                updated_at = $7, version = version + 1
          WHERE id = $1
          RETURNING *`,
        [
          game.id,
          revision,
          color === "black" ? playerClock.mainTimeMs : Number(game.black_time_remaining_ms),
          color === "white" ? playerClock.mainTimeMs : Number(game.white_time_remaining_ms),
          color === "black" ? playerClock.periodsRemaining : game.black_periods_remaining,
          color === "white" ? playerClock.periodsRemaining : game.white_periods_remaining,
          now,
        ],
      );
      const scoring: ScoringRow = {
        game_id: game.id,
        board_hash: nextHash,
        stopped_move_number: nextMoveNumber,
        revision,
        rules: game.rules,
        rules_profile: game.rules_profile,
        scoring_method: game.scoring_method,
        komi: game.komi,
        handicap: game.handicap,
        fallback_to_move: opposite(color),
        expires_at: new Date(now.getTime() + SCORING_RESPONSE_WINDOW_MS),
        black_confirmed_revision: null,
        white_confirmed_revision: null,
        black_confirmed_at: null,
        white_confirmed_at: null,
        scored_board_hash: null,
        black_stones: null,
        white_stones: null,
        black_territory: null,
        white_territory: null,
        neutral_points: null,
        black_dead_stones: null,
        white_dead_stones: null,
        black_total: null,
        white_total: null,
        result: null,
        started_at: now,
        updated_at: now,
        finalized_at: null,
      };
      return serializeGame({ ...withUpdatedGame(loaded, updated.rows[0]), scoring }, now);
    }

    const updated = await client.query<GameRow>(
      `UPDATE games
          SET to_move = $2, consecutive_passes = $3,
              black_time_remaining_ms = $4, white_time_remaining_ms = $5,
              black_periods_remaining = $6, white_periods_remaining = $7,
              turn_started_at = $8, updated_at = $8, version = version + 1
        WHERE id = $1
        RETURNING *`,
      [
        game.id,
        opposite(color),
        consecutivePasses,
        color === "black" ? playerClock.mainTimeMs : Number(game.black_time_remaining_ms),
        color === "white" ? playerClock.mainTimeMs : Number(game.white_time_remaining_ms),
        color === "black" ? playerClock.periodsRemaining : game.black_periods_remaining,
        color === "white" ? playerClock.periodsRemaining : game.white_periods_remaining,
        now,
      ],
    );
    return serializeGame(withUpdatedGame(loaded, updated.rows[0]), now);
  });
}

export async function setDeadGroup(
  gameId: string,
  playerKey: string,
  proposal: { x: number; y: number; dead: boolean; expectedRevision: number },
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadGame(client, gameId, true);
    assertParticipant(loaded.game, playerKey);
    const resumed = await resumeExpiredScoring(client, loaded, new Date());
    if (resumed) return serializeGame(resumed);
    const scoring = assertScoringPhase(loaded, proposal.expectedRevision);
    if (typeof proposal.dead !== "boolean") {
      throw new GameServiceError("The dead-stone state is required.", 400, "invalid_dead_state");
    }
    const board = stoppedBoard(loaded, scoring);
    let toggled: ReturnType<typeof toggleDeadGroup>;
    try {
      toggled = toggleDeadGroup(
        board,
        loaded.deadRows.map(({ x, y }) => ({ x, y })),
        { x: proposal.x, y: proposal.y },
        proposal.dead,
      );
    } catch (error) {
      throw new GameServiceError(
        error instanceof Error ? error.message : "Invalid dead-stone proposal.",
        400,
        "invalid_dead_stone",
      );
    }
    if (!toggled.changed) return serializeGame(loaded);

    const revision = scoring.revision + 1;
    const now = new Date();
    await client.query("DELETE FROM game_dead_stones WHERE game_id = $1", [loaded.game.id]);
    if (toggled.deadStones.length > 0) {
      const xs = toggled.deadStones.map(({ x }) => x);
      const ys = toggled.deadStones.map(({ y }) => y);
      const colors = toggled.deadStones.map(({ x, y }) => board[y][x]);
      await client.query(
        `INSERT INTO game_dead_stones (game_id, x, y, color)
         SELECT $1, proposal.x, proposal.y, proposal.color
           FROM UNNEST($2::int[], $3::int[], $4::text[])
             AS proposal(x, y, color)`,
        [loaded.game.id, xs, ys, colors],
      );
    }
    const scoringResult = await client.query<ScoringRow>(
      `UPDATE game_scoring_state
          SET revision = $2,
              black_confirmed_revision = NULL, white_confirmed_revision = NULL,
              black_confirmed_at = NULL, white_confirmed_at = NULL,
              updated_at = $3
        WHERE game_id = $1
        RETURNING *`,
      [loaded.game.id, revision, now],
    );
    const gameResult = await client.query<GameRow>(
      `UPDATE games
          SET scoring_revision = $2, updated_at = $3, version = version + 1
        WHERE id = $1
        RETURNING *`,
      [loaded.game.id, revision, now],
    );
    const deadRows: DeadStoneRow[] = toggled.deadStones.map(({ x, y }) => ({
      x,
      y,
      color: board[y][x]!,
    }));
    return serializeGame({
      ...withUpdatedGame(loaded, gameResult.rows[0]),
      scoring: scoringResult.rows[0],
      deadRows,
    }, now);
  });
}

export async function confirmScore(
  gameId: string,
  playerKey: string,
  expectedRevision: number,
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadGame(client, gameId, true);
    assertParticipant(loaded.game, playerKey);
    const resumed = await resumeExpiredScoring(client, loaded, new Date());
    if (resumed) return serializeGame(resumed);
    const color = playerColor(loaded.game, playerKey);
    if (loaded.game.status === "finished") {
      if (
        loaded.game.finish_reason === "score"
        && loaded.scoring?.revision === expectedRevision
        && loaded.scoring[`${color}_confirmed_revision`] === expectedRevision
      ) {
        return serializeGame(loaded);
      }
      throw new GameServiceError("This game is already finished.", 409, "game_finished");
    }
    const scoring = assertScoringPhase(loaded, expectedRevision);
    const confirmationKey = `${color}_confirmed_revision` as const;
    if (scoring[confirmationKey] === expectedRevision) return serializeGame(loaded);

    const now = new Date();
    const revisionColumn = color === "black" ? "black_confirmed_revision" : "white_confirmed_revision";
    const timeColumn = color === "black" ? "black_confirmed_at" : "white_confirmed_at";
    const scoringResult = await client.query<ScoringRow>(
      `UPDATE game_scoring_state
          SET ${revisionColumn} = $2, ${timeColumn} = $3, updated_at = $3
        WHERE game_id = $1
        RETURNING *`,
      [loaded.game.id, expectedRevision, now],
    );
    const gameResult = await client.query<GameRow>(
      `UPDATE games SET updated_at = $2, version = version + 1 WHERE id = $1 RETURNING *`,
      [loaded.game.id, now],
    );
    const nextLoaded = {
      ...withUpdatedGame(loaded, gameResult.rows[0]),
      scoring: scoringResult.rows[0],
    };
    const bothConfirmed =
      nextLoaded.scoring.black_confirmed_revision === expectedRevision
      && nextLoaded.scoring.white_confirmed_revision === expectedRevision;
    if (!bothConfirmed) return serializeGame(nextLoaded, now);

    const board = stoppedBoard(nextLoaded, nextLoaded.scoring);
    const deadStones = nextLoaded.deadRows.map(({ x, y }) => ({ x, y }));
    const score = scoreChineseAgreement(board, deadStones, Number(nextLoaded.scoring.komi));
    const winnerKey = score.winner === "black"
      ? loaded.game.black_player_key
      : score.winner === "white"
        ? loaded.game.white_player_key
        : null;
    const deadCounts = nextLoaded.deadRows.reduce(
      (counts, stone) => ({ ...counts, [stone.color]: counts[stone.color] + 1 }),
      { black: 0, white: 0 },
    );
    const scoredBoard = board.map((row) => [...row]);
    for (const { x, y } of deadStones) scoredBoard[y][x] = null;
    const finalScoring = await client.query<ScoringRow>(
      `UPDATE game_scoring_state
          SET scored_board_hash = $2,
              black_stones = $3, white_stones = $4,
              black_territory = $5, white_territory = $6,
              neutral_points = $7, black_dead_stones = $8, white_dead_stones = $9,
              black_total = $10, white_total = $11, result = $12,
              finalized_at = $13, updated_at = $13
        WHERE game_id = $1
        RETURNING *`,
      [
        loaded.game.id,
        boardHash(scoredBoard),
        score.blackStones,
        score.whiteStones,
        score.blackTerritory,
        score.whiteTerritory,
        score.neutralPoints,
        deadCounts.black,
        deadCounts.white,
        score.black,
        score.white,
        score.result,
        now,
      ],
    );
    const finished = await client.query<GameRow>(
      `UPDATE games
          SET status = 'finished', phase = 'scoring', to_move = NULL,
              finish_reason = 'score', result = $2, winner_key = $3,
              finished_at = $4, updated_at = $4, version = version + 1
        WHERE id = $1
        RETURNING *`,
      [loaded.game.id, score.result, winnerKey, now],
    );
    const finalLoaded = {
      ...withUpdatedGame(nextLoaded, finished.rows[0]),
      scoring: finalScoring.rows[0],
    };
    await recordFinishedStats(client, finalLoaded.game, winnerKey);
    return serializeGame(finalLoaded, now);
  });
}

export async function resumePlay(
  gameId: string,
  playerKey: string,
  expectedRevision: number,
  claim: "dead" | "alive",
  disputedStone: Position,
): Promise<GameState> {
  return withTransaction(async (client) => {
    const loaded = await loadGame(client, gameId, true);
    assertParticipant(loaded.game, playerKey);
    const expired = await resumeExpiredScoring(client, loaded, new Date());
    if (expired) return serializeGame(expired);
    const scoring = assertScoringPhase(loaded, expectedRevision);
    if (claim !== "dead" && claim !== "alive") {
      throw new GameServiceError("A valid dispute claim is required.", 400, "invalid_dispute_claim");
    }
    if (!Number.isInteger(disputedStone.x) || !Number.isInteger(disputedStone.y)) {
      throw new GameServiceError(
        "A disputed stone coordinate is required.",
        400,
        "invalid_disputed_stone",
      );
    }
    const board = stoppedBoard(loaded, scoring);
    const disputedGroup = getGroup(board, disputedStone);
    const deadKeys = new Set(loaded.deadRows.map(({ x, y }) => `${x}:${y}`));
    if (
      disputedGroup.length === 0
      || !disputedGroup.every(({ x, y }) => deadKeys.has(`${x}:${y}`))
    ) {
      throw new GameServiceError(
        "Resume play must identify a currently marked dead group.",
        409,
        "disputed_group_not_marked_dead",
      );
    }
    const now = new Date();
    await client.query("DELETE FROM game_scoring_state WHERE game_id = $1", [loaded.game.id]);
    const updated = await client.query<GameRow>(
      `UPDATE games
          SET phase = 'play', to_move = $2, consecutive_passes = 0,
              scoring_revision = scoring_revision + 1,
              last_resume_claim = $3, last_resume_by = $4,
              last_resume_x = $5, last_resume_y = $6,
              turn_started_at = $7, updated_at = $7, version = version + 1
        WHERE id = $1
        RETURNING *`,
      [
        loaded.game.id,
        resumeTurnForClaim(playerColor(loaded.game, playerKey), claim),
        claim,
        playerColor(loaded.game, playerKey),
        disputedStone.x,
        disputedStone.y,
        now,
      ],
    );
    return serializeGame({
      ...withUpdatedGame(loaded, updated.rows[0]),
      scoring: null,
      deadRows: [],
    }, now);
  });
}

export async function resignGame(gameId: string, playerKey: string): Promise<GameState> {
  return withTransaction(async (client) => {
    let loaded = await loadGame(client, gameId, true);
    assertParticipant(loaded.game, playerKey);
    loaded = await resumeExpiredScoring(client, loaded, new Date()) ?? loaded;
    const { game } = loaded;
    if (game.status !== "active") {
      throw new GameServiceError("This game is already finished.", 409, "game_finished");
    }

    const now = new Date();
    const turn = currentTurn(game, loaded.moveRows);
    if (turn) {
      const clocks = calculateClocks(game, turn, now);
      if (clocks[turn].timedOut) return finishOnTime(client, loaded, turn, now);
    }

    const winnerKey = playerKey === game.black_player_key
      ? game.white_player_key
      : game.black_player_key;
    const winnerColor = winnerKey === game.black_player_key ? "B" : "W";
    const updated = await client.query<GameRow>(
      `UPDATE games
          SET status = 'finished', to_move = NULL, finish_reason = 'resignation',
              result = $2, winner_key = $3,
              finished_at = $4, updated_at = $4, version = version + 1
        WHERE id = $1
        RETURNING *`,
      [game.id, `${winnerColor}+R`, winnerKey, now],
    );
    const nextLoaded = withUpdatedGame(loaded, updated.rows[0]);
    await recordFinishedStats(client, nextLoaded.game, winnerKey);
    return serializeGame(nextLoaded, now);
  });
}
