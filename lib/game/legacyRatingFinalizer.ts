import type { PoolClient } from "pg";
import { GameServiceError } from "./gameServiceError";
import {
  resolveRatingParticipants,
  type RatingParticipantRow,
} from "./ratingPolicy";

type LegacyRatedGame = Readonly<{
  id: string;
  board_size: number;
  black_player_key: string;
  white_player_key: string;
  finished_at: Date | null;
  finish_reason: string | null;
}>;

export async function recordLegacyFinishedStats(
  client: PoolClient,
  game: LegacyRatedGame,
  winnerKey: string | null,
): Promise<boolean> {
  if (
    game.finish_reason === "japanese_no_result"
    || game.finish_reason === "japanese_repetition"
  ) return false;

  const existingHistory = await client.query<{ player_key: string }>(
    `SELECT player_key
       FROM player_rating_history
      WHERE game_id = $1
      FOR UPDATE`,
    [game.id],
  );
  if (existingHistory.rowCount !== 0) {
    throw new GameServiceError(
      "The rating history already contains evidence before this game finalization.",
      500,
      "rating_history_conflict",
    );
  }

  const candidates = await client.query<RatingParticipantRow>(
    `SELECT 'user:' || id::text AS player_key,
            1200::int AS initial_rating,
            'account'::text AS participant_type
       FROM users
      WHERE 'user:' || id::text IN ($1::text, $2::text)
      UNION ALL
     SELECT bot_player_key AS player_key,
            target_rating AS initial_rating,
            'bot'::text AS participant_type
       FROM game_bots
      WHERE game_id = $3
        AND bot_player_key IN ($1::text, $2::text)`,
    [game.black_player_key, game.white_player_key, game.id],
  );
  const ratedParticipants = resolveRatingParticipants(
    [game.black_player_key, game.white_player_key],
    candidates.rows,
  );
  if (!ratedParticipants) return false;
  const initialRatings = new Map(
    ratedParticipants.map(({ player_key, initial_rating }) => [player_key, initial_rating]),
  );

  for (const playerKey of [game.black_player_key, game.white_player_key].sort()) {
    const won = winnerKey === playerKey;
    const draw = winnerKey === null;
    const ratingDelta = draw ? 0 : won ? 16 : -16;
    await client.query(
      `INSERT INTO player_stats (player_key, board_size, rating, highest_rating)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (player_key, board_size) DO NOTHING`,
      [playerKey, game.board_size, initialRatings.get(playerKey)],
    );
    const current = await client.query<{ rating: number }>(
      `SELECT rating
         FROM player_stats
        WHERE player_key = $1 AND board_size = $2
        FOR UPDATE`,
      [playerKey, game.board_size],
    );
    const ratingBefore = current.rows[0].rating;
    const ratingAfter = Math.max(100, ratingBefore + ratingDelta);
    const ledger = await client.query<{ id: string }>(
      `INSERT INTO player_rating_history
         (player_key, game_id, board_size, rating_before, rating_after,
          rating_change, result, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
       ON CONFLICT (player_key, game_id) DO NOTHING
       RETURNING id`,
      [
        playerKey,
        game.id,
        game.board_size,
        ratingBefore,
        ratingAfter,
        ratingAfter - ratingBefore,
        draw ? "draw" : won ? "win" : "loss",
        game.finished_at,
      ],
    );
    if (ledger.rowCount !== 1) {
      throw new GameServiceError(
        "The rating history could not be recorded exactly once.",
        500,
        "rating_history_conflict",
      );
    }
    await client.query(
      `UPDATE player_stats
          SET games = games + 1,
              wins = wins + $3,
              losses = losses + $4,
              draws = draws + $5,
              rating = $6,
              highest_rating = GREATEST(highest_rating, $6),
              updated_at = NOW()
        WHERE player_key = $1 AND board_size = $2`,
      [
        playerKey,
        game.board_size,
        won ? 1 : 0,
        !won && !draw ? 1 : 0,
        draw ? 1 : 0,
        ratingAfter,
      ],
    );
  }
  return true;
}
