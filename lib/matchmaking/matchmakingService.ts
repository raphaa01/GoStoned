import { query, withTransaction } from "@/lib/db";
import { getTimeControl } from "@/lib/game/timeControls";
import type { BoardSize, TimeControlId } from "@/lib/game/types";

export type MatchmakingStatus =
  | { status: "idle"; gameId: null; boardSize: null; timeControl: null }
  | { status: "waiting"; gameId: null; boardSize: BoardSize; timeControl: TimeControlId }
  | { status: "matched"; gameId: string; boardSize: BoardSize; timeControl: TimeControlId };

type QueueRow = {
  player_key: string;
  board_size: BoardSize;
  time_control: TimeControlId;
  status: "waiting" | "matched";
  game_id: string | null;
  created_at: Date;
  game_status?: "active" | "finished" | null;
  is_stale?: boolean;
};

export function isBoardSize(value: unknown): value is BoardSize {
  return value === 9 || value === 13 || value === 19;
}

function mapQueue(row?: QueueRow): MatchmakingStatus {
  if (!row) return { status: "idle", gameId: null, boardSize: null, timeControl: null };
  if (row.status === "matched" && row.game_id) {
    return {
      status: "matched",
      gameId: row.game_id,
      boardSize: row.board_size,
      timeControl: row.time_control,
    };
  }
  return {
    status: "waiting",
    gameId: null,
    boardSize: row.board_size,
    timeControl: row.time_control,
  };
}

export async function getMatchmakingStatus(playerKey: string): Promise<MatchmakingStatus> {
  const result = await query<QueueRow>(
    `SELECT q.player_key, q.board_size, q.time_control, q.status, q.game_id, q.created_at,
            g.status AS game_status,
            q.updated_at < NOW() - INTERVAL '5 minutes' AS is_stale
       FROM matchmaking_queue q
       LEFT JOIN games g ON g.id = q.game_id
      WHERE q.player_key = $1`,
    [playerKey],
  );
  const row = result.rows[0];
  if (row?.status === "matched" && row.game_status !== "active") {
    await cancelMatchmaking(playerKey);
    return { status: "idle", gameId: null, boardSize: null, timeControl: null };
  }
  if (row?.status === "waiting" && row.is_stale) {
    await cancelMatchmaking(playerKey);
    return { status: "idle", gameId: null, boardSize: null, timeControl: null };
  }
  return mapQueue(row);
}

export async function joinMatchmaking(
  playerKey: string,
  boardSize: BoardSize,
  timeControlId: TimeControlId,
): Promise<MatchmakingStatus> {
  const timeControl = getTimeControl(timeControlId);
  return withTransaction(async (client) => {
    await client.query(
      `DELETE FROM matchmaking_queue
        WHERE status = 'waiting' AND updated_at < NOW() - INTERVAL '5 minutes'`,
    );

    const existing = await client.query<QueueRow>(
      `SELECT q.player_key, q.board_size, q.time_control, q.status, q.game_id, q.created_at,
              g.status AS game_status
         FROM matchmaking_queue q
         LEFT JOIN games g ON g.id = q.game_id
        WHERE q.player_key = $1
        FOR UPDATE OF q`,
      [playerKey],
    );
    if (
      existing.rows[0]?.status === "matched" &&
      existing.rows[0].game_id &&
      existing.rows[0].game_status === "active"
    ) {
      return mapQueue(existing.rows[0]);
    }

    await client.query(
      `INSERT INTO matchmaking_queue (player_key, board_size, time_control, status, game_id)
       VALUES ($1, $2, $3, 'waiting', NULL)
       ON CONFLICT (player_key) DO UPDATE
       SET board_size = EXCLUDED.board_size, time_control = EXCLUDED.time_control,
           status = 'waiting', game_id = NULL,
           created_at = NOW(), updated_at = NOW()`,
      [playerKey, boardSize, timeControlId],
    );

    const opponentResult = await client.query<QueueRow>(
      `SELECT player_key, board_size, time_control, status, game_id, created_at
         FROM matchmaking_queue
        WHERE board_size = $1 AND time_control = $2
          AND status = 'waiting' AND player_key <> $3
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [boardSize, timeControlId, playerKey],
    );
    const opponent = opponentResult.rows[0];
    if (!opponent) {
      return {
        status: "waiting",
        gameId: null,
        boardSize,
        timeControl: timeControlId,
      };
    }

    const gameResult = await client.query<{ id: string }>(
      `INSERT INTO games (
         board_size, black_player_key, white_player_key, time_control,
         main_time_seconds, byo_yomi_periods, byo_yomi_seconds,
         black_time_remaining_ms, white_time_remaining_ms,
         black_periods_remaining, white_periods_remaining, turn_started_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $6, $6, NOW())
       RETURNING id`,
      [
        boardSize,
        opponent.player_key,
        playerKey,
        timeControlId,
        timeControl.mainTimeSeconds,
        timeControl.byoYomiPeriods,
        timeControl.byoYomiSeconds,
        timeControl.mainTimeSeconds * 1_000,
      ],
    );
    const gameId = gameResult.rows[0].id;

    await client.query(
      `UPDATE matchmaking_queue
          SET status = 'matched', game_id = $1, updated_at = NOW()
        WHERE player_key = ANY($2::text[])`,
      [gameId, [opponent.player_key, playerKey]],
    );
    return {
      status: "matched",
      gameId,
      boardSize,
      timeControl: timeControlId,
    };
  });
}

export async function cancelMatchmaking(playerKey: string): Promise<void> {
  await query("DELETE FROM matchmaking_queue WHERE player_key = $1", [playerKey]);
}
