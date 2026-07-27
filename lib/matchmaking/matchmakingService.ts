import { query, withTransaction } from "@/lib/db";
import type { BoardSize } from "@/lib/game/types";

export type MatchmakingStatus =
  | { status: "idle"; gameId: null; boardSize: null }
  | { status: "waiting"; gameId: null; boardSize: BoardSize }
  | { status: "matched"; gameId: string; boardSize: BoardSize };

type QueueRow = {
  player_key: string;
  board_size: BoardSize;
  status: "waiting" | "matched";
  game_id: string | null;
  created_at: Date;
  game_status?: "active" | "finished" | null;
  is_stale?: boolean;
};

export function isValidPlayerKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(guest|user):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function isBoardSize(value: unknown): value is BoardSize {
  return value === 9 || value === 13 || value === 19;
}

function mapQueue(row?: QueueRow): MatchmakingStatus {
  if (!row) return { status: "idle", gameId: null, boardSize: null };
  if (row.status === "matched" && row.game_id) {
    return { status: "matched", gameId: row.game_id, boardSize: row.board_size };
  }
  return { status: "waiting", gameId: null, boardSize: row.board_size };
}

export async function getMatchmakingStatus(playerKey: string): Promise<MatchmakingStatus> {
  const result = await query<QueueRow>(
    `SELECT q.player_key, q.board_size, q.status, q.game_id, q.created_at,
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
    return { status: "idle", gameId: null, boardSize: null };
  }
  if (row?.status === "waiting" && row.is_stale) {
    await cancelMatchmaking(playerKey);
    return { status: "idle", gameId: null, boardSize: null };
  }
  return mapQueue(row);
}

export async function joinMatchmaking(
  playerKey: string,
  boardSize: BoardSize,
): Promise<MatchmakingStatus> {
  return withTransaction(async (client) => {
    await client.query(
      `DELETE FROM matchmaking_queue
        WHERE status = 'waiting' AND updated_at < NOW() - INTERVAL '5 minutes'`,
    );

    const existing = await client.query<QueueRow>(
      `SELECT q.player_key, q.board_size, q.status, q.game_id, q.created_at,
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
      `INSERT INTO matchmaking_queue (player_key, board_size, status, game_id)
       VALUES ($1, $2, 'waiting', NULL)
       ON CONFLICT (player_key) DO UPDATE
       SET board_size = EXCLUDED.board_size, status = 'waiting', game_id = NULL,
           created_at = NOW(), updated_at = NOW()`,
      [playerKey, boardSize],
    );

    const opponentResult = await client.query<QueueRow>(
      `SELECT player_key, board_size, status, game_id, created_at
         FROM matchmaking_queue
        WHERE board_size = $1 AND status = 'waiting' AND player_key <> $2
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [boardSize, playerKey],
    );
    const opponent = opponentResult.rows[0];
    if (!opponent) return { status: "waiting", gameId: null, boardSize };

    const gameResult = await client.query<{ id: string }>(
      `INSERT INTO games (board_size, black_player_key, white_player_key)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [boardSize, opponent.player_key, playerKey],
    );
    const gameId = gameResult.rows[0].id;

    await client.query(
      `UPDATE matchmaking_queue
          SET status = 'matched', game_id = $1, updated_at = NOW()
        WHERE player_key = ANY($2::text[])`,
      [gameId, [opponent.player_key, playerKey]],
    );
    return { status: "matched", gameId, boardSize };
  });
}

export async function cancelMatchmaking(playerKey: string): Promise<void> {
  await query("DELETE FROM matchmaking_queue WHERE player_key = $1", [playerKey]);
}
