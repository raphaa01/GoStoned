-- Complete the rating-event discriminator for databases that applied 028
-- before the inline opponent_kind constraint was widened.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE game_glicko2_rating_events
  DROP CONSTRAINT IF EXISTS game_glicko2_rating_events_opponent_kind_check;

ALTER TABLE game_glicko2_rating_events
  ADD CONSTRAINT game_glicko2_rating_events_opponent_kind_check
  CHECK (opponent_kind IN ('registered_human','calibrated_bot','browser_bot'));
