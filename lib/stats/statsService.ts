import { query } from "@/lib/db";
import type { BoardSize } from "@/lib/game/types";

export type PlayerStat = {
  player_name: string;
  board_size: BoardSize;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
  highest_rating: number;
  updated_at: Date;
};

export async function getLeaderboard(boardSize: BoardSize, limit = 50) {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const result = await query<PlayerStat>(
    `SELECT
            CASE
              WHEN ps.player_key LIKE 'guest:%'
                THEN 'Guest ' || UPPER(RIGHT(ps.player_key, 6))
              ELSE COALESCE(NULLIF(BTRIM(u.display_name), ''), u.username, 'Player')
            END AS player_name,
            ps.board_size, ps.games, ps.wins, ps.losses, ps.draws, ps.rating,
            ps.highest_rating, ps.updated_at
       FROM player_stats ps
       LEFT JOIN users u ON ps.player_key = 'user:' || u.id::text
      WHERE ps.board_size = $1
      ORDER BY ps.rating DESC, ps.games DESC
      LIMIT $2`,
    [boardSize, safeLimit],
  );

  return result.rows;
}
