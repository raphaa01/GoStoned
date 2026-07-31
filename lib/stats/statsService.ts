import { query } from "@/lib/db";
import type { BoardSize } from "@/lib/game/types";
import type { LeaderboardEntry } from "./leaderboardContract";

export type LeaderboardSnapshot = {
  entries: LeaderboardEntry[];
  observedAt: Date;
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
  opponentIsBot?: boolean;
  result: "win" | "loss" | "draw";
  gameResult: string | null;
  ratingChange: number | null;
  rated: boolean;
  finishedAt: string;
  moveCount: number;
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
  opponent_is_bot: boolean;
  result: "win" | "loss" | "draw";
  game_result: string | null;
  rating_change: number | null;
  rated: boolean;
  finished_at: Date;
  move_count: number;
};

type LeaderboardSnapshotRow = {
  entries: LeaderboardEntry[];
  observed_at: Date;
};

export async function getLeaderboard(
  boardSize: BoardSize,
  limit = 50,
): Promise<LeaderboardSnapshot> {
  const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 50;
  const safeLimit = Math.min(Math.max(normalizedLimit, 1), 100);
  const result = await query<LeaderboardSnapshotRow>(
    `WITH registered_rating_rows AS (
       SELECT history.id,
              history.player_key,
              history.board_size,
              history.game_id,
              history.rating_before,
              history.rating_after,
              history.result,
              history.recorded_at,
              game_record.winner_key,
              (
                SELECT COUNT(*)::int
                  FROM player_rating_history game_history
                 WHERE game_history.game_id = history.game_id
              ) AS total_game_ledger_rows
         FROM player_rating_history history
         JOIN games game_record ON game_record.id = history.game_id
         JOIN users black_user
           ON game_record.black_player_key = 'user:' || black_user.id::text
         JOIN users white_user
           ON game_record.white_player_key = 'user:' || white_user.id::text
        WHERE history.board_size = $1
          AND game_record.status = 'finished'
          AND game_record.board_size = history.board_size
          AND history.player_key IN (
                game_record.black_player_key,
                game_record.white_player_key
              )
     ), ordered_rating_rows AS (
       SELECT registered_rating_rows.*,
              LAG(rating_after, 1, 1200) OVER (
                PARTITION BY player_key, board_size
                ORDER BY recorded_at, id
              ) AS expected_rating_before
         FROM registered_rating_rows
     ), atomic_rating_games AS (
       SELECT game_id
         FROM ordered_rating_rows
        GROUP BY game_id
       HAVING COUNT(*) = 2
          AND COUNT(DISTINCT player_key) = 2
          AND (
            BOOL_AND(winner_key IS NULL)
            OR COUNT(*) FILTER (WHERE winner_key = player_key) = 1
          )
          AND BOOL_AND(
            total_game_ledger_rows = 2
            AND rating_before = expected_rating_before
            AND CASE result
              WHEN 'win' THEN rating_after = rating_before + 16
              WHEN 'loss' THEN rating_after = GREATEST(100, rating_before - 16)
              ELSE rating_after = rating_before
            END
            AND CASE
              WHEN winner_key IS NULL THEN result = 'draw'
              WHEN winner_key = player_key THEN result = 'win'
              ELSE result = 'loss'
            END
          )
     ), verified_rating_games AS (
       SELECT ordered_rating_rows.id,
              ordered_rating_rows.player_key,
              ordered_rating_rows.board_size,
              ordered_rating_rows.game_id,
              ordered_rating_rows.rating_after,
              ordered_rating_rows.result,
              ordered_rating_rows.recorded_at
         FROM ordered_rating_rows
         JOIN atomic_rating_games USING (game_id)
     ), verified_totals AS (
       SELECT player_key,
              board_size,
              COUNT(*)::int AS games,
              COUNT(*) FILTER (WHERE result = 'win')::int AS wins,
              COUNT(*) FILTER (WHERE result = 'loss')::int AS losses,
              COUNT(*) FILTER (WHERE result = 'draw')::int AS draws
         FROM verified_rating_games
        GROUP BY player_key, board_size
     ), history_inventory AS (
       SELECT player_key, board_size, COUNT(*)::int AS games
         FROM player_rating_history
        WHERE board_size = $1
        GROUP BY player_key, board_size
     ), latest_verified_rating AS (
       SELECT DISTINCT ON (player_key, board_size)
              player_key, board_size, rating_after
         FROM verified_rating_games
        ORDER BY player_key, board_size, recorded_at DESC, id DESC
     ), eligible AS (
       SELECT ps.player_key,
              COALESCE(NULLIF(BTRIM(u.display_name), ''), u.username, 'Player') AS player_name,
              ps.games, ps.wins, ps.rating
         FROM player_stats ps
         JOIN users u ON ps.player_key = 'user:' || u.id::text
         JOIN verified_totals totals
           ON totals.player_key = ps.player_key
          AND totals.board_size = ps.board_size
         JOIN history_inventory inventory
           ON inventory.player_key = ps.player_key
          AND inventory.board_size = ps.board_size
         JOIN latest_verified_rating latest
           ON latest.player_key = ps.player_key
          AND latest.board_size = ps.board_size
        WHERE ps.board_size = $1
          AND ps.games > 0
          AND ps.games = totals.games
          AND inventory.games = totals.games
          AND ps.wins = totals.wins
          AND ps.losses = totals.losses
          AND ps.draws = totals.draws
          AND ps.rating = latest.rating_after
          AND ps.rating >= 100
          AND CHAR_LENGTH(
                COALESCE(NULLIF(BTRIM(u.display_name), ''), u.username, 'Player')
              ) BETWEEN 1 AND 80
     ), ranked AS (
       SELECT (ROW_NUMBER() OVER (
                ORDER BY rating DESC, games DESC, player_key ASC
              ))::int AS position,
              player_name, games, wins, rating
         FROM eligible
     ), visible AS (
       SELECT position, player_name, games, wins, rating
         FROM ranked
        WHERE position <= $2
        ORDER BY position
     )
     SELECT statement_timestamp() AS observed_at,
            COALESCE(
              JSONB_AGG(
                JSONB_BUILD_OBJECT(
                  'position', position,
                  'playerName', player_name,
                  'games', games,
                  'wins', wins,
                  'rating', rating
                ) ORDER BY position
              ),
              '[]'::jsonb
            ) AS entries
       FROM visible`,
    [boardSize, safeLimit],
  );

  const snapshot = result.rows[0];
  if (!snapshot) throw new Error("Leaderboard query did not return a snapshot.");
  return { entries: snapshot.entries, observedAt: snapshot.observed_at };
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
                CASE WHEN g.white_player_key = game_bot.bot_player_key THEN game_bot.display_name END,
                NULLIF(BTRIM(white_user.display_name), ''),
                white_user.username,
                'Guest ' || UPPER(RIGHT(g.white_player_key, 6))
              )
            ELSE
              COALESCE(
                CASE WHEN g.black_player_key = game_bot.bot_player_key THEN game_bot.display_name END,
                NULLIF(BTRIM(black_user.display_name), ''),
                black_user.username,
                'Guest ' || UPPER(RIGHT(g.black_player_key, 6))
              )
          END AS opponent_name,
          CASE
            WHEN g.black_player_key = $1 THEN g.white_player_key = game_bot.bot_player_key
            ELSE g.black_player_key = game_bot.bot_player_key
          END AS opponent_is_bot,
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
          (SELECT COUNT(*)::int FROM moves recent_move WHERE recent_move.game_id = g.id) AS move_count,
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
        LEFT JOIN game_bots game_bot ON game_bot.game_id = g.id
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
    opponentIsBot: row.opponent_is_bot,
    result: row.result,
    gameResult: row.game_result,
    ratingChange: row.rating_change,
    rated: row.rated,
    finishedAt: row.finished_at.toISOString(),
    moveCount: row.move_count,
  }));

  return { stats, history, recentGames };
}
