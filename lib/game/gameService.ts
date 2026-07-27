import type { PoolClient, QueryResultRow } from "pg";
import { query, withTransaction } from "@/lib/db";
import { applyMove, boardHash, createEmptyBoard, replayMoves, scoreChinese } from "./goEngine";
import { advanceClock, restingClock, type ClockAdvance } from "./goClock";
import type {
  BoardSize,
  GameState,
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
  result: string | null;
  komi: string | number;
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
): Promise<{ game: GameRow; moveRows: MoveRow[] }> {
  const execute = <T extends QueryResultRow>(
    text: string,
    values: readonly unknown[],
  ) => client ? client.query<T>(text, [...values]) : query<T>(text, values);
  const gameResult = await execute<GameRow>(
    `SELECT g.id, g.board_size, g.black_player_key, g.white_player_key, g.winner_key,
            g.status, g.result, g.komi, g.time_control, g.main_time_seconds,
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
  return { game, moveRows: movesResult.rows };
}

function currentTurn(game: GameRow, moveRows: MoveRow[]): Stone | null {
  if (game.status !== "active") return null;
  return moveRows.length % 2 === 0 ? "black" : "white";
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
    black:
      turn === "black"
        ? advanceClock({ ...blackInput, elapsedMs })
        : restingClock(
            blackInput.mainTimeMs,
            blackInput.periodsRemaining,
            blackInput.periodTimeMs,
          ),
    white:
      turn === "white"
        ? advanceClock({ ...whiteInput, elapsedMs })
        : restingClock(
            whiteInput.mainTimeMs,
            whiteInput.periodsRemaining,
            whiteInput.periodTimeMs,
          ),
  };
}

function serializeGame(game: GameRow, moveRows: MoveRow[], now = new Date()): GameState {
  const moves = mapMoves(moveRows);
  const turn = currentTurn(game, moveRows);
  const clocks = calculateClocks(game, turn, now);
  return {
    id: game.id,
    boardSize: game.board_size,
    blackPlayerKey: game.black_player_key,
    whitePlayerKey: game.white_player_key,
    blackPlayerName: game.black_player_name,
    whitePlayerName: game.white_player_name,
    winnerKey: game.winner_key,
    status: game.status,
    result: game.result,
    komi: Number(game.komi),
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
    board: replayMoves(game.board_size, moves),
    moves,
  };
}

function withPlayerNames(row: GameRow, original: GameRow): GameRow {
  return {
    ...row,
    black_player_name: original.black_player_name,
    white_player_name: original.white_player_name,
  };
}

async function recordFinishedStats(
  client: PoolClient,
  game: GameRow,
  winnerKey: string | null,
) {
  for (const playerKey of [game.black_player_key, game.white_player_key]) {
    const won = winnerKey === playerKey;
    const draw = winnerKey === null;
    const ratingDelta = draw ? 0 : won ? 16 : -16;
    await client.query(
      `INSERT INTO player_stats
         (player_key, board_size, games, wins, losses, draws, rating, highest_rating)
       VALUES ($1, $2, 1, $3, $4, $5, 1200 + $6, GREATEST(1200, 1200 + $6))
       ON CONFLICT (player_key, board_size) DO UPDATE
       SET games = player_stats.games + 1,
           wins = player_stats.wins + $3,
           losses = player_stats.losses + $4,
           draws = player_stats.draws + $5,
           rating = GREATEST(100, player_stats.rating + $6),
           highest_rating = GREATEST(
             player_stats.highest_rating,
             GREATEST(100, player_stats.rating + $6)
           ),
           updated_at = NOW()`,
      [playerKey, game.board_size, won ? 1 : 0, !won && !draw ? 1 : 0, draw ? 1 : 0, ratingDelta],
    );
  }
}

async function finishOnTime(
  client: PoolClient,
  game: GameRow,
  moveRows: MoveRow[],
  timedOutColor: Stone,
  now: Date,
): Promise<GameState> {
  const winnerKey =
    timedOutColor === "black" ? game.white_player_key : game.black_player_key;
  const winnerColor = timedOutColor === "black" ? "W" : "B";
  const updated = await client.query<GameRow>(
    `UPDATE games
        SET status = 'finished', result = $2, winner_key = $3,
            black_time_remaining_ms = CASE WHEN $4 = 'black' THEN 0 ELSE black_time_remaining_ms END,
            white_time_remaining_ms = CASE WHEN $4 = 'white' THEN 0 ELSE white_time_remaining_ms END,
            black_periods_remaining = CASE WHEN $4 = 'black' THEN 0 ELSE black_periods_remaining END,
            white_periods_remaining = CASE WHEN $4 = 'white' THEN 0 ELSE white_periods_remaining END,
            finished_at = $5, updated_at = $5, version = version + 1
      WHERE id = $1
      RETURNING id, board_size, black_player_key, white_player_key, winner_key,
                status, result, komi, time_control, main_time_seconds,
                byo_yomi_periods, byo_yomi_seconds, black_time_remaining_ms,
                white_time_remaining_ms, black_periods_remaining,
                white_periods_remaining, turn_started_at, version,
                started_at, finished_at`,
    [game.id, `${winnerColor}+T`, winnerKey, timedOutColor, now],
  );
  await recordFinishedStats(client, game, winnerKey);
  return serializeGame(withPlayerNames(updated.rows[0], game), moveRows, now);
}

export async function getGameState(gameId: string, playerKey: string): Promise<GameState> {
  return withTransaction(async (client) => {
    const { game, moveRows } = await loadGame(client, gameId, true);
    assertParticipant(game, playerKey);
    const now = new Date();
    const turn = currentTurn(game, moveRows);
    if (turn) {
      const clocks = calculateClocks(game, turn, now);
      if (clocks[turn].timedOut) {
        return finishOnTime(client, game, moveRows, turn, now);
      }
    }
    return serializeGame(game, moveRows, now);
  });
}

export async function submitMove(
  gameId: string,
  playerKey: string,
  move: { x?: number; y?: number; isPass?: boolean },
): Promise<GameState> {
  return withTransaction(async (client) => {
    const { game, moveRows } = await loadGame(client, gameId, true);
    assertParticipant(game, playerKey);
    if (game.status !== "active") {
      throw new GameServiceError("This game is already finished.", 409, "game_finished");
    }

    const color: Stone = moveRows.length % 2 === 0 ? "black" : "white";
    const expectedPlayer = color === "black" ? game.black_player_key : game.white_player_key;
    if (playerKey !== expectedPlayer) {
      throw new GameServiceError("It is not your turn.", 409, "not_your_turn");
    }

    const now = new Date();
    const clocks = calculateClocks(game, color, now);
    const playerClock = clocks[color];
    if (playerClock.timedOut) {
      return finishOnTime(client, game, moveRows, color, now);
    }

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
        throw new GameServiceError("Illegal move: this position repeats an earlier board.", 409, "ko");
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

    const twoPasses =
      isPass && moveRows.length >= 2 && moveRows[moveRows.length - 2].is_pass;
    if (twoPasses) {
      const finalBoard = replayMoves(game.board_size, mapMoves(moveRows));
      const score = scoreChinese(finalBoard, Number(game.komi));
      const winnerKey =
        score.winner === "black"
          ? game.black_player_key
          : score.winner === "white"
            ? game.white_player_key
            : null;
      const updated = await client.query<GameRow>(
        `UPDATE games
            SET status = 'finished', result = $2, winner_key = $3,
                black_time_remaining_ms = $4,
                white_time_remaining_ms = $5,
                black_periods_remaining = $6,
                white_periods_remaining = $7,
                finished_at = $8, updated_at = $8, version = version + 1
          WHERE id = $1
          RETURNING id, board_size, black_player_key, white_player_key, winner_key,
                    status, result, komi, time_control, main_time_seconds,
                    byo_yomi_periods, byo_yomi_seconds, black_time_remaining_ms,
                    white_time_remaining_ms, black_periods_remaining,
                    white_periods_remaining, turn_started_at, version,
                    started_at, finished_at`,
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
      await recordFinishedStats(client, game, winnerKey);
      return serializeGame(withPlayerNames(updated.rows[0], game), moveRows, now);
    }

    const updated = await client.query<GameRow>(
      `UPDATE games
          SET black_time_remaining_ms = $2,
              white_time_remaining_ms = $3,
              black_periods_remaining = $4,
              white_periods_remaining = $5,
              turn_started_at = $6, updated_at = NOW(), version = version + 1
        WHERE id = $1
        RETURNING id, board_size, black_player_key, white_player_key, winner_key,
                  status, result, komi, time_control, main_time_seconds,
                  byo_yomi_periods, byo_yomi_seconds, black_time_remaining_ms,
                  white_time_remaining_ms, black_periods_remaining,
                  white_periods_remaining, turn_started_at, version,
                  started_at, finished_at`,
      [
        game.id,
        color === "black" ? playerClock.mainTimeMs : Number(game.black_time_remaining_ms),
        color === "white" ? playerClock.mainTimeMs : Number(game.white_time_remaining_ms),
        color === "black" ? playerClock.periodsRemaining : game.black_periods_remaining,
        color === "white" ? playerClock.periodsRemaining : game.white_periods_remaining,
        now,
      ],
    );
    return serializeGame(withPlayerNames(updated.rows[0], game), moveRows, now);
  });
}

export async function resignGame(gameId: string, playerKey: string): Promise<GameState> {
  return withTransaction(async (client) => {
    const { game, moveRows } = await loadGame(client, gameId, true);
    assertParticipant(game, playerKey);
    if (game.status !== "active") {
      throw new GameServiceError("This game is already finished.", 409, "game_finished");
    }

    const winnerKey =
      playerKey === game.black_player_key ? game.white_player_key : game.black_player_key;
    const winnerColor = winnerKey === game.black_player_key ? "B" : "W";
    const updated = await client.query<GameRow>(
      `UPDATE games
          SET status = 'finished', result = $2, winner_key = $3,
              finished_at = NOW(), updated_at = NOW(), version = version + 1
        WHERE id = $1
        RETURNING id, board_size, black_player_key, white_player_key, winner_key,
                  status, result, komi, time_control, main_time_seconds,
                  byo_yomi_periods, byo_yomi_seconds, black_time_remaining_ms,
                  white_time_remaining_ms, black_periods_remaining,
                  white_periods_remaining, turn_started_at, version,
                  started_at, finished_at`,
      [game.id, `${winnerColor}+R`, winnerKey],
    );
    await recordFinishedStats(client, game, winnerKey);
    return serializeGame(withPlayerNames(updated.rows[0], game), moveRows);
  });
}
