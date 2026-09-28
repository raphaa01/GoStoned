import type { PoolClient, QueryResultRow } from "pg";
import { withReadOnlyTransaction, withTransaction } from "@/lib/db";
import { replayMovesWithPrisoners } from "./goEngine";
import { GameServiceError } from "./gameServiceError";
import type { Board, BoardSize, Position, Stone, StoredMove, TimeControlId } from "./types";

type SharedGameRow = QueryResultRow & {
  board_size: BoardSize;
  black_player_name: string;
  white_player_name: string;
  result: string;
  finish_reason: "score" | "resignation" | "timeout" | "legacy_score";
  time_control: TimeControlId;
  finished_at: Date;
};

type SharedMoveRow = QueryResultRow & {
  move_number: number;
  color: Stone;
  x: number | null;
  y: number | null;
  is_pass: boolean;
  created_at: Date;
};

export type SharedFinishedGame = Readonly<{
  boardSize: BoardSize;
  board: Board;
  blackPlayerName: string;
  whitePlayerName: string;
  result: string;
  finishReason: SharedGameRow["finish_reason"];
  timeControl: TimeControlId;
  moveCount: number;
  lastMove: Position | null;
  deadStones: Position[];
  finishedAt: string;
}>;

export async function createFinishedGameShare(gameId: string, playerKey: string): Promise<string> {
  return withTransaction(async (client) => {
    const game = await client.query<{
      black_player_key: string;
      white_player_key: string;
      status: "active" | "finished";
      finished_at: Date | null;
    }>(
      `SELECT black_player_key, white_player_key, status, finished_at
         FROM games WHERE id = $1 FOR SHARE`,
      [gameId],
    );
    const row = game.rows[0];
    if (!row) throw new GameServiceError("Game not found.", 404, "game_not_found");
    if (row.black_player_key !== playerKey && row.white_player_key !== playerKey) {
      throw new GameServiceError("Game not found.", 404, "game_not_found");
    }
    if (row.status !== "finished" || !row.finished_at) {
      throw new GameServiceError("Only finished games can be shared.", 409, "game_not_finished");
    }
    const share = await client.query<{ token: string }>(
      `INSERT INTO game_share_links (game_id, created_by_player_key)
       VALUES ($1, $2)
       ON CONFLICT (game_id) DO UPDATE SET game_id = EXCLUDED.game_id
       RETURNING token::text`,
      [gameId, playerKey],
    );
    return share.rows[0].token;
  });
}

function mapMoves(rows: SharedMoveRow[]): StoredMove[] {
  return rows.map((move) => ({
    moveNumber: move.move_number,
    color: move.color,
    x: move.x,
    y: move.y,
    isPass: move.is_pass,
    createdAt: move.created_at.toISOString(),
  }));
}

export async function getSharedFinishedGame(token: string): Promise<SharedFinishedGame> {
  return withReadOnlyTransaction(async (client: PoolClient) => {
    const game = await client.query<SharedGameRow>(
      `SELECT g.board_size, g.result, g.finish_reason, g.time_control, g.finished_at,
              COALESCE(NULLIF(BTRIM(black_user.display_name), ''), black_user.username,
                CASE WHEN g.black_player_key = bot.bot_player_key THEN bot.display_name END,
                'Guest ' || UPPER(RIGHT(g.black_player_key, 6))) AS black_player_name,
              COALESCE(NULLIF(BTRIM(white_user.display_name), ''), white_user.username,
                CASE WHEN g.white_player_key = bot.bot_player_key THEN bot.display_name END,
                'Guest ' || UPPER(RIGHT(g.white_player_key, 6))) AS white_player_name
         FROM game_share_links share
         JOIN games g ON g.id = share.game_id
         LEFT JOIN users black_user ON g.black_player_key = 'user:' || black_user.id::text
         LEFT JOIN users white_user ON g.white_player_key = 'user:' || white_user.id::text
         LEFT JOIN game_bots bot ON bot.game_id = g.id
        WHERE share.token = $1 AND g.status = 'finished' AND g.finished_at IS NOT NULL
          AND g.result IS NOT NULL AND g.finish_reason IS NOT NULL`,
      [token],
    );
    const row = game.rows[0];
    if (!row) throw new GameServiceError("Shared game not found.", 404, "shared_game_not_found");
    const [movesResult, deadResult] = await Promise.all([
      client.query<SharedMoveRow>(
        `SELECT move_number, color, x, y, is_pass, created_at
           FROM moves WHERE game_id = (SELECT game_id FROM game_share_links WHERE token = $1)
          ORDER BY move_number`,
        [token],
      ),
      client.query<QueryResultRow & Position>(
        `SELECT x, y FROM game_dead_stones
          WHERE game_id = (SELECT game_id FROM game_share_links WHERE token = $1)
          ORDER BY y, x`,
        [token],
      ),
    ]);
    const moves = mapMoves(movesResult.rows);
    const board = replayMovesWithPrisoners(row.board_size, moves).board;
    const lastPlayed = [...moves].reverse().find((move) => !move.isPass);
    return {
      boardSize: row.board_size,
      board,
      blackPlayerName: row.black_player_name,
      whitePlayerName: row.white_player_name,
      result: row.result,
      finishReason: row.finish_reason,
      timeControl: row.time_control,
      moveCount: moves.length,
      lastMove: lastPlayed?.x === null || lastPlayed?.x === undefined || lastPlayed.y === null
        ? null
        : { x: lastPlayed.x, y: lastPlayed.y },
      deadStones: deadResult.rows.map(({ x, y }) => ({ x, y })),
      finishedAt: row.finished_at.toISOString(),
    };
  });
}
