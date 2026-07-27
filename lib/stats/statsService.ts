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
              WHEN player_key LIKE 'guest:%' THEN 'Guest ' || UPPER(RIGHT(player_key, 6))
              ELSE 'Player ' || UPPER(RIGHT(player_key, 6))
            END AS player_name,
            board_size, games, wins, losses, draws, rating,
            highest_rating, updated_at
       FROM player_stats
      WHERE board_size = $1
      ORDER BY rating DESC, games DESC
      LIMIT $2`,
    [boardSize, safeLimit],
  );

  return result.rows;
}
