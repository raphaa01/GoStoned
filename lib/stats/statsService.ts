import { query } from "@/lib/db";
import type { BoardSize } from "@/lib/game/types";
import type { RatingDisplayPreference } from "@/lib/rating/rankPolicy";
import type { BotMatchPreference, StartingStrengthEstimate } from "@/lib/rating/preferences";
import type { LeaderboardEntry } from "./leaderboardContract";

export type LeaderboardSnapshot = {
  entries: LeaderboardEntry[];
  observedAt: Date;
};

export type GlobalRatingSummary = {
  rating: number;
  ratingDeviation: number;
  volatility: number;
  ratedGameCount: number;
  isProvisional: boolean;
  algorithmVersion: string;
  lastRatingPeriodAt: string;
  highestRating: number;
  ratingChange30Days: number;
};

export type PublicRatingPreferences = {
  displayPreference: RatingDisplayPreference;
  botMatchPreference: BotMatchPreference;
  handicapPreference: "even-only" | "verified-handicap-ok";
  preferenceRevision: number;
  startingStrengthEstimate: StartingStrengthEstimate | null;
  knownRank: string | null;
};

export type RatingHistoryEntry = {
  id: string;
  gameId: string;
  boardSize: BoardSize;
  ratingBefore: number;
  ratingAfter: number;
  ratingChange: number;
  result: "win" | "loss" | "draw" | "no-result";
  recordedAt: string;
};

export type RecentGame = {
  gameId: string;
  boardSize: BoardSize;
  timeControl: "blitz" | "rapid" | "classic";
  opponentName: string;
  opponentIsBot: boolean;
  opponentBotProfileVersion: string | null;
  result: "win" | "loss" | "draw" | "no-result";
  gameResult: string | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingChange: number | null;
  rated: boolean;
  finishedAt: string;
  moveCount: number;
};

type GlobalRatingRow = {
  rating: number;
  rating_deviation: number;
  volatility: number;
  rated_game_count: number;
  is_provisional: boolean;
  algorithm_version: string;
  last_rating_period_at: Date;
  highest_rating: number;
  rating_change_30_days: number;
  display_preference: RatingDisplayPreference;
  bot_match_preference: BotMatchPreference;
  handicap_preference: "even-only" | "verified-handicap-ok";
  preference_revision: number;
  starting_strength_estimate: StartingStrengthEstimate | null;
  known_rank: string | null;
};

type RatingHistoryRow = {
  id: string;
  game_id: string;
  board_size: BoardSize;
  rating_before: number;
  rating_after: number;
  rating_change: number;
  result: "win" | "loss" | "draw" | "no-result";
  recorded_at: Date;
};

type RecentGameRow = {
  game_id: string;
  board_size: BoardSize;
  time_control: "blitz" | "rapid" | "classic";
  opponent_name: string;
  opponent_is_bot: boolean;
  opponent_bot_profile_version: string | null;
  result: "win" | "loss" | "draw" | "no-result";
  game_result: string | null;
  rating_before: number | null;
  rating_after: number | null;
  rating_change: number | null;
  rated: boolean;
  finished_at: Date;
  move_count: number;
};

type LeaderboardSnapshotRow = {
  entries: LeaderboardEntry[];
  observed_at: Date;
};

export async function getLeaderboard(limit = 50): Promise<LeaderboardSnapshot> {
  const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 50;
  const safeLimit = Math.min(Math.max(normalizedLimit, 1), 100);
  const result = await query<LeaderboardSnapshotRow>(
    `WITH verified_totals AS (
       SELECT player_key,
              COUNT(*) FILTER (WHERE outcome_kind <> 'no_result')::int AS games,
              COUNT(*) FILTER (WHERE outcome_kind = 'win')::int AS wins
         FROM game_glicko2_rating_events
        GROUP BY player_key
     ), eligible AS (
       SELECT rating.player_key,
              COALESCE(NULLIF(BTRIM(account.display_name), ''), account.username, 'Player') AS player_name,
              rating.rated_game_count AS games,
              totals.wins,
              rating.rating::double precision AS rating,
              rating.rating_deviation::double precision AS rating_deviation
         FROM player_glicko2_ratings rating
         JOIN users account ON account.id = rating.user_id
         JOIN verified_totals totals ON totals.player_key = rating.player_key
        WHERE rating.rated_game_count >= 10
          AND rating.rated_game_count = totals.games
          AND CHAR_LENGTH(
                COALESCE(NULLIF(BTRIM(account.display_name), ''), account.username, 'Player')
              ) BETWEEN 1 AND 80
     ), ranked AS (
       SELECT (ROW_NUMBER() OVER (
                ORDER BY rating DESC, rating_deviation ASC, games DESC, player_key ASC
              ))::int AS position,
              player_name, games, wins, rating, rating_deviation
         FROM eligible
     ), visible AS (
       SELECT position, player_name, games, wins, rating, rating_deviation
         FROM ranked
        WHERE position <= $1
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
                  'rating', rating,
                  'ratingDeviation', rating_deviation
                ) ORDER BY position
              ),
              '[]'::jsonb
            ) AS entries
       FROM visible`,
    [safeLimit],
  );

  const snapshot = result.rows[0];
  if (!snapshot) throw new Error("Leaderboard query did not return a snapshot.");
  return { entries: snapshot.entries, observedAt: snapshot.observed_at };
}

export async function getPlayerProfileStats(playerKey: string) {
  const [ratingResult, historyResult, recentGamesResult] = await Promise.all([
    query<GlobalRatingRow>(
      `SELECT rating.rating::double precision AS rating,
              rating.rating_deviation::double precision AS rating_deviation,
              rating.volatility::double precision AS volatility,
              rating.rated_game_count,
              rating.is_provisional,
              rating.algorithm_version,
              rating.last_rating_period_at,
              GREATEST(
                rating.rating::double precision,
                COALESCE((
                  SELECT MAX(event.rating_after)::double precision
                    FROM game_glicko2_rating_events event
                   WHERE event.player_key = rating.player_key
                ), rating.rating::double precision)
              ) AS highest_rating,
              COALESCE((
                SELECT SUM(event.rating_after - event.rating_before)::double precision
                  FROM game_glicko2_rating_events event
                 WHERE event.player_key = rating.player_key
                   AND event.rating_period_at >= NOW() - INTERVAL '30 days'
              ), 0) AS rating_change_30_days,
              preference.display_preference,
              preference.bot_match_preference,
              preference.handicap_preference,
              preference.preference_revision,
              claim.estimate AS starting_strength_estimate,
              claim.known_rank
         FROM player_glicko2_ratings rating
         JOIN player_rating_preferences preference
           ON preference.player_key = rating.player_key
         LEFT JOIN player_initial_rating_claims claim
           ON claim.user_id = rating.user_id
        WHERE rating.player_key = $1
        LIMIT 1`,
      [playerKey],
    ),
    query<RatingHistoryRow>(
      `SELECT event.game_id || ':' || event.player_key AS id,
              event.game_id,
              game_record.board_size,
              event.rating_before::double precision AS rating_before,
              event.rating_after::double precision AS rating_after,
              (event.rating_after - event.rating_before)::double precision AS rating_change,
              CASE event.outcome_kind
                WHEN 'no_result' THEN 'no-result'
                ELSE event.outcome_kind
              END AS result,
              event.rating_period_at AS recorded_at
         FROM game_glicko2_rating_events event
         JOIN games game_record ON game_record.id = event.game_id
        WHERE event.player_key = $1
        ORDER BY event.rating_period_at ASC, event.game_id ASC
        LIMIT 300`,
      [playerKey],
    ),
    query<RecentGameRow>(
      `SELECT game_record.id AS game_id,
              game_record.board_size,
              game_record.time_control,
              CASE
                WHEN game_record.black_player_key = $1 THEN COALESCE(
                  CASE WHEN game_record.white_player_key = game_bot.bot_player_key
                    THEN game_bot.display_name END,
                  NULLIF(BTRIM(white_user.display_name), ''), white_user.username,
                  'Guest ' || UPPER(RIGHT(game_record.white_player_key, 6)))
                ELSE COALESCE(
                  CASE WHEN game_record.black_player_key = game_bot.bot_player_key
                    THEN game_bot.display_name END,
                  NULLIF(BTRIM(black_user.display_name), ''), black_user.username,
                  'Guest ' || UPPER(RIGHT(game_record.black_player_key, 6)))
              END AS opponent_name,
              COALESCE(
                CASE WHEN game_record.black_player_key = $1
                  THEN game_record.white_player_key = game_bot.bot_player_key
                  ELSE game_record.black_player_key = game_bot.bot_player_key END,
                FALSE
              ) AS opponent_is_bot,
              CASE WHEN rating_event.opponent_kind = 'calibrated_bot'
                THEN rating_event.opponent_profile_version ELSE NULL END
                AS opponent_bot_profile_version,
              CASE
                WHEN rating_event.outcome_kind = 'no_result' THEN 'no-result'
                WHEN rating_event.outcome_kind IS NOT NULL THEN rating_event.outcome_kind
                WHEN game_record.finish_reason IN ('japanese_no_result', 'japanese_repetition')
                  AND game_record.winner_key IS NULL THEN 'no-result'
                WHEN game_record.winner_key IS NULL THEN 'draw'
                WHEN game_record.winner_key = $1 THEN 'win'
                ELSE 'loss'
              END AS result,
              game_record.result AS game_result,
              rating_event.rating_before::double precision AS rating_before,
              rating_event.rating_after::double precision AS rating_after,
              (rating_event.rating_after - rating_event.rating_before)::double precision AS rating_change,
              rating_event.game_id IS NOT NULL AS rated,
              (SELECT COUNT(*)::int FROM moves move WHERE move.game_id = game_record.id) AS move_count,
              game_record.finished_at
         FROM games game_record
         LEFT JOIN users black_user
           ON game_record.black_player_key = 'user:' || black_user.id::text
         LEFT JOIN users white_user
           ON game_record.white_player_key = 'user:' || white_user.id::text
         LEFT JOIN game_bots game_bot ON game_bot.game_id = game_record.id
         LEFT JOIN game_glicko2_rating_events rating_event
           ON rating_event.game_id = game_record.id AND rating_event.player_key = $1
        WHERE game_record.status = 'finished'
          AND (game_record.black_player_key = $1 OR game_record.white_player_key = $1)
          AND game_record.finished_at IS NOT NULL
        ORDER BY game_record.finished_at DESC, game_record.id DESC
        LIMIT 36`,
      [playerKey],
    ),
  ]);

  const row = ratingResult.rows[0];
  if (!row) throw new Error("Global rating state is unavailable for this account.");
  const rating: GlobalRatingSummary = {
    rating: row.rating,
    ratingDeviation: row.rating_deviation,
    volatility: row.volatility,
    ratedGameCount: row.rated_game_count,
    isProvisional: row.is_provisional,
    algorithmVersion: row.algorithm_version,
    lastRatingPeriodAt: row.last_rating_period_at.toISOString(),
    highestRating: row.highest_rating,
    ratingChange30Days: row.rating_change_30_days,
  };
  const preferences: PublicRatingPreferences = {
    displayPreference: row.display_preference,
    botMatchPreference: row.bot_match_preference,
    handicapPreference: row.handicap_preference,
    preferenceRevision: row.preference_revision,
    startingStrengthEstimate: row.starting_strength_estimate,
    knownRank: row.known_rank,
  };
  const history: RatingHistoryEntry[] = historyResult.rows.map((entry) => ({
    id: entry.id,
    gameId: entry.game_id,
    boardSize: entry.board_size,
    ratingBefore: entry.rating_before,
    ratingAfter: entry.rating_after,
    ratingChange: entry.rating_change,
    result: entry.result,
    recordedAt: entry.recorded_at.toISOString(),
  }));
  const recentGames: RecentGame[] = recentGamesResult.rows.map((game) => ({
    gameId: game.game_id,
    boardSize: game.board_size,
    timeControl: game.time_control,
    opponentName: game.opponent_name,
    opponentIsBot: game.opponent_is_bot,
    opponentBotProfileVersion: game.opponent_bot_profile_version,
    result: game.result,
    gameResult: game.game_result,
    ratingBefore: game.rating_before,
    ratingAfter: game.rating_after,
    ratingChange: game.rating_change,
    rated: game.rated,
    finishedAt: game.finished_at.toISOString(),
    moveCount: game.move_count,
  }));

  return { rating, preferences, history, recentGames };
}
