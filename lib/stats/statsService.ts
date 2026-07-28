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

export type ProfileStat = {
  boardSize: BoardSize;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
  highestRating: number;
  ratingChange30Days: number;
};

export type RatingHistoryEntry = {
  id: string;
  gameId: string;
  boardSize: BoardSize;
  ratingBefore: number;
  ratingAfter: number;
  ratingChange: number;
  result: "win" | "loss" | "draw";
  recordedAt: string;
};

export type RecentGame = {
  gameId: string;
  boardSize: BoardSize;
  timeControl: "blitz" | "rapid" | "classic";
  opponentName: string;
  result: "win" | "loss" | "draw";
  gameResult: string | null;
  ratingChange: number | null;
  rated: boolean;
  finishedAt: string;
};

type ProfileStatRow = {
  board_size: BoardSize;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
  highest_rating: number;
  rating_change_30_days: number;
};

type RatingHistoryRow = {
  id: string;
  game_id: string;
  board_size: BoardSize;
  rating_before: number;
  rating_after: number;
  rating_change: number;
  result: "win" | "loss" | "draw";
  recorded_at: Date;
};

type RecentGameRow = {
  game_id: string;
  board_size: BoardSize;
  time_control: "blitz" | "rapid" | "classic";
  opponent_name: string;
  result: "win" | "loss" | "draw";
  game_result: string | null;
  rating_change: number | null;
  rated: boolean;
  finished_at: Date;
};

export async function getLeaderboard(boardSize: BoardSize, limit = 50) {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const result = await query<PlayerStat>(
    `SELECT
            COALESCE(NULLIF(BTRIM(u.display_name), ''), u.username, 'Player') AS player_name,
            ps.board_size, ps.games, ps.wins, ps.losses, ps.draws, ps.rating,
            ps.highest_rating, ps.updated_at
       FROM player_stats ps
       JOIN users u ON ps.player_key = 'user:' || u.id::text
      WHERE ps.board_size = $1
      ORDER BY ps.rating DESC, ps.games DESC
      LIMIT $2`,
    [boardSize, safeLimit],
  );

  return result.rows;
}

export async function getPlayerProfileStats(playerKey: string) {
  const [statsResult, historyResult, recentGamesResult] = await Promise.all([
    query<ProfileStatRow>(
      `SELECT
          stats.board_size,
          stats.games,
          stats.wins,
          stats.losses,
          stats.draws,
          stats.rating,
          stats.highest_rating,
          COALESCE((
            SELECT SUM(history.rating_change)
              FROM player_rating_history history
             WHERE history.player_key = stats.player_key
               AND history.board_size = stats.board_size
               AND history.recorded_at >= NOW() - INTERVAL '30 days'
          ), 0)::int AS rating_change_30_days
         FROM player_stats stats
        WHERE stats.player_key = $1
        ORDER BY stats.board_size`,
      [playerKey],
    ),
    query<RatingHistoryRow>(
      `SELECT id::text, game_id, board_size, rating_before, rating_after,
              rating_change, result, recorded_at
         FROM (
           SELECT id, game_id, board_size, rating_before, rating_after,
                  rating_change, result, recorded_at
             FROM player_rating_history
            WHERE player_key = $1
            ORDER BY recorded_at DESC, id DESC
            LIMIT 300
         ) recent_history
        ORDER BY recorded_at ASC, id ASC`,
      [playerKey],
    ),
    query<RecentGameRow>(
      `SELECT
          g.id AS game_id,
          g.board_size,
          g.time_control,
          CASE
            WHEN g.black_player_key = $1 THEN
              COALESCE(
                NULLIF(BTRIM(white_user.display_name), ''),
                white_user.username,
                'Guest ' || UPPER(RIGHT(g.white_player_key, 6))
              )
            ELSE
              COALESCE(
                NULLIF(BTRIM(black_user.display_name), ''),
                black_user.username,
                'Guest ' || UPPER(RIGHT(g.black_player_key, 6))
              )
          END AS opponent_name,
          CASE
            WHEN g.winner_key IS NULL THEN 'draw'
            WHEN g.winner_key = $1 THEN 'win'
            ELSE 'loss'
          END AS result,
          g.result AS game_result,
          history.rating_change,
          (
            SELECT COUNT(DISTINCT rated_history.player_key) = 2
              FROM player_rating_history rated_history
             WHERE rated_history.game_id = g.id
               AND rated_history.player_key IN (
                 g.black_player_key,
                 g.white_player_key
               )
          ) AS rated,
          g.finished_at
        FROM (
          SELECT games.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY board_size
                   ORDER BY finished_at DESC, id DESC
                 ) AS board_rank
            FROM games
           WHERE status = 'finished'
             AND (black_player_key = $1 OR white_player_key = $1)
             AND finished_at IS NOT NULL
        ) g
        LEFT JOIN users black_user
          ON g.black_player_key = 'user:' || black_user.id::text
        LEFT JOIN users white_user
          ON g.white_player_key = 'user:' || white_user.id::text
        LEFT JOIN player_rating_history history
          ON history.game_id = g.id AND history.player_key = $1
       WHERE g.board_rank <= 12
       ORDER BY g.finished_at DESC
       LIMIT 36`,
      [playerKey],
    ),
  ]);

  const stats: ProfileStat[] = statsResult.rows.map((row) => ({
    boardSize: row.board_size,
    games: row.games,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    rating: row.rating,
    highestRating: row.highest_rating,
    ratingChange30Days: row.rating_change_30_days,
  }));
  const history: RatingHistoryEntry[] = historyResult.rows.map((row) => ({
    id: row.id,
    gameId: row.game_id,
    boardSize: row.board_size,
    ratingBefore: row.rating_before,
    ratingAfter: row.rating_after,
    ratingChange: row.rating_change,
    result: row.result,
    recordedAt: row.recorded_at.toISOString(),
  }));
  const recentGames: RecentGame[] = recentGamesResult.rows.map((row) => ({
    gameId: row.game_id,
    boardSize: row.board_size,
    timeControl: row.time_control,
    opponentName: row.opponent_name,
    result: row.result,
    gameResult: row.game_result,
    ratingChange: row.rating_change,
    rated: row.rated,
    finishedAt: row.finished_at.toISOString(),
  }));

  return { stats, history, recentGames };
}
