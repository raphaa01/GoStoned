import type { PoolClient, QueryResultRow } from "pg";
import { query, withTransaction } from "@/lib/db";
import { applyMove, boardHash, createEmptyBoard, replayMoves, scoreChinese } from "./goEngine";
import type { BoardSize, GameState, Stone, StoredMove } from "./types";

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
            g.status, g.result, g.komi, g.version, g.started_at, g.finished_at,
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

function serializeGame(game: GameRow, moveRows: MoveRow[]): GameState {
  const moves = mapMoves(moveRows);
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
    turn: game.status === "active" ? (moves.length % 2 === 0 ? "black" : "white") : null,
    moveCount: moves.length,
    board: replayMoves(game.board_size, moves),
    moves,
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

export async function getGameState(gameId: string, playerKey: string): Promise<GameState> {
  const { game, moveRows } = await loadGame(null, gameId);
  assertParticipant(game, playerKey);
  return serializeGame(game, moveRows);
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
                finished_at = NOW(), updated_at = NOW(), version = version + 1
          WHERE id = $1
          RETURNING id, board_size, black_player_key, white_player_key, winner_key,
                    status, result, komi, version, started_at, finished_at`,
        [game.id, score.result, winnerKey],
      );
      await recordFinishedStats(client, game, winnerKey);
      return serializeGame(
        {
          ...updated.rows[0],
          black_player_name: game.black_player_name,
          white_player_name: game.white_player_name,
        },
        moveRows,
      );
    }

    const updated = await client.query<GameRow>(
      `UPDATE games
          SET updated_at = NOW(), version = version + 1
        WHERE id = $1
        RETURNING id, board_size, black_player_key, white_player_key, winner_key,
                  status, result, komi, version, started_at, finished_at`,
      [game.id],
    );
    return serializeGame(
      {
        ...updated.rows[0],
        black_player_name: game.black_player_name,
        white_player_name: game.white_player_name,
      },
      moveRows,
    );
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
                  status, result, komi, version, started_at, finished_at`,
      [game.id, `${winnerColor}+R`, winnerKey],
    );
    await recordFinishedStats(client, game, winnerKey);
    return serializeGame(
      {
        ...updated.rows[0],
        black_player_name: game.black_player_name,
        white_player_name: game.white_player_name,
      },
      moveRows,
    );
  });
}
