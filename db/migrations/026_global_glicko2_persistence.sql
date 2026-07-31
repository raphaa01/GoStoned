-- Activate one global Glicko-2 state per registered account. Existing
-- per-board fixed-update rows remain readable and are labeled honestly.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE player_rating_history
  ADD COLUMN IF NOT EXISTS rating_algorithm_version TEXT;

UPDATE player_rating_history
   SET rating_algorithm_version = 'fixed-elo-legacy-v1'
 WHERE rating_algorithm_version IS NULL;

ALTER TABLE player_rating_history
  ALTER COLUMN rating_algorithm_version SET DEFAULT 'fixed-elo-legacy-v1',
  ALTER COLUMN rating_algorithm_version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'player_rating_history_algorithm_check'
       AND conrelid = 'public.player_rating_history'::regclass
  ) THEN
    ALTER TABLE player_rating_history
      ADD CONSTRAINT player_rating_history_algorithm_check
      CHECK (rating_algorithm_version = 'fixed-elo-legacy-v1');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS player_glicko2_ratings (
  player_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  rating NUMERIC(12,6) NOT NULL,
  rating_deviation NUMERIC(12,6) NOT NULL,
  volatility NUMERIC(12,9) NOT NULL,
  rated_game_count INT NOT NULL DEFAULT 0,
  is_provisional BOOLEAN GENERATED ALWAYS AS (rated_game_count < 10) STORED,
  algorithm_version TEXT NOT NULL,
  last_rating_period_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT player_glicko2_ratings_user_fk FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT player_glicko2_ratings_player_key_check CHECK (
    player_key = 'user:' || user_id::text
  ),
  CONSTRAINT player_glicko2_ratings_rating_check CHECK (
    rating BETWEEN -10000 AND 10000
  ),
  CONSTRAINT player_glicko2_ratings_deviation_check CHECK (
    rating_deviation > 0 AND rating_deviation <= 10000
  ),
  CONSTRAINT player_glicko2_ratings_volatility_check CHECK (
    volatility > 0 AND volatility <= 10
  ),
  CONSTRAINT player_glicko2_ratings_game_count_check CHECK (rated_game_count >= 0),
  CONSTRAINT player_glicko2_ratings_algorithm_check CHECK (
    algorithm_version = 'glicko2-v1-tau-0.5'
  ),
  CONSTRAINT player_glicko2_ratings_time_check CHECK (
    updated_at >= created_at AND last_rating_period_at >= created_at
  )
);

-- A legacy account can have three incompatible current per-board ratings.
-- Select its most recently updated row exactly; never average or select the
-- highest. Ties prefer more games, then the smaller board. All legacy rows
-- remain untouched in player_stats and player_rating_history.
INSERT INTO player_glicko2_ratings
  (player_key,user_id,rating,rating_deviation,volatility,rated_game_count,
   algorithm_version,last_rating_period_at)
SELECT 'user:' || account.id::text,
       account.id,
       COALESCE(legacy.rating, 1200),
       350,
       0.06,
       0,
       'glicko2-v1-tau-0.5',
       statement_timestamp()
  FROM users AS account
  LEFT JOIN LATERAL (
    SELECT stats.rating
      FROM player_stats AS stats
     WHERE stats.player_key = 'user:' || account.id::text
     ORDER BY stats.updated_at DESC NULLS LAST,
              stats.games DESC,
              stats.board_size ASC
     LIMIT 1
  ) AS legacy ON TRUE
ON CONFLICT (player_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS game_glicko2_rating_events (
  game_id UUID NOT NULL,
  player_key TEXT NOT NULL,
  opponent_key TEXT NOT NULL,
  opponent_kind TEXT NOT NULL CHECK (
    opponent_kind IN ('registered_human', 'calibrated_bot')
  ),
  opponent_profile_version TEXT,
  player_color TEXT NOT NULL CHECK (player_color IN ('black', 'white')),
  outcome_kind TEXT NOT NULL CHECK (
    outcome_kind IN ('win', 'loss', 'draw', 'no_result')
  ),
  score NUMERIC(2,1),
  finish_reason TEXT NOT NULL,
  game_result TEXT NOT NULL CHECK (LENGTH(game_result) BETWEEN 1 AND 40),
  game_finished_at TIMESTAMPTZ NOT NULL,
  opponent_rating NUMERIC(12,6) NOT NULL,
  opponent_rating_deviation NUMERIC(12,6) NOT NULL,
  rating_before NUMERIC(12,6) NOT NULL,
  rating_after NUMERIC(12,6) NOT NULL,
  rating_deviation_before NUMERIC(12,6) NOT NULL,
  rating_deviation_after NUMERIC(12,6) NOT NULL,
  volatility_before NUMERIC(12,9) NOT NULL,
  volatility_after NUMERIC(12,9) NOT NULL,
  rated_game_count_before INT NOT NULL,
  rated_game_count_after INT NOT NULL,
  last_rating_period_at_before TIMESTAMPTZ NOT NULL,
  last_rating_period_at_after TIMESTAMPTZ NOT NULL,
  algorithm_version TEXT NOT NULL,
  rating_period_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (game_id, player_key),
  CONSTRAINT game_glicko2_rating_events_game_fk FOREIGN KEY (game_id)
    REFERENCES games(id) ON DELETE RESTRICT,
  CONSTRAINT game_glicko2_rating_events_player_fk FOREIGN KEY (player_key)
    REFERENCES player_glicko2_ratings(player_key) ON DELETE RESTRICT,
  CONSTRAINT game_glicko2_rating_events_distinct_players_check CHECK (
    player_key <> opponent_key
  ),
  CONSTRAINT game_glicko2_rating_events_opponent_check CHECK (COALESCE((
    (
      opponent_kind = 'registered_human'
      AND opponent_key LIKE 'user:%'
      AND opponent_profile_version IS NULL
    )
    OR
    (
      opponent_kind = 'calibrated_bot'
      AND opponent_key LIKE 'bot:%'
      AND LENGTH(opponent_profile_version) BETWEEN 1 AND 120
    )
  ), FALSE)),
  CONSTRAINT game_glicko2_rating_events_outcome_check CHECK (COALESCE((
    (
      outcome_kind = 'no_result'
      AND score IS NULL
      AND rating_after = rating_before
      AND rating_deviation_after = rating_deviation_before
      AND volatility_after = volatility_before
      AND rated_game_count_after = rated_game_count_before
      AND last_rating_period_at_after = last_rating_period_at_before
    )
    OR
    (
      outcome_kind IN ('win', 'loss', 'draw')
      AND score = CASE outcome_kind WHEN 'win' THEN 1 WHEN 'loss' THEN 0 ELSE 0.5 END
      AND rated_game_count_after = rated_game_count_before + 1
      AND last_rating_period_at_after = rating_period_at
    )
  ), FALSE)),
  CONSTRAINT game_glicko2_rating_events_bounds_check CHECK (
    opponent_rating BETWEEN -10000 AND 10000
    AND rating_before BETWEEN -10000 AND 10000
    AND rating_after BETWEEN -10000 AND 10000
    AND opponent_rating_deviation > 0 AND opponent_rating_deviation <= 10000
    AND rating_deviation_before > 0 AND rating_deviation_before <= 10000
    AND rating_deviation_after > 0 AND rating_deviation_after <= 10000
    AND volatility_before > 0 AND volatility_before <= 10
    AND volatility_after > 0 AND volatility_after <= 10
    AND rated_game_count_before >= 0 AND rated_game_count_after >= 0
  ),
  CONSTRAINT game_glicko2_rating_events_algorithm_check CHECK (
    algorithm_version = 'glicko2-v1-tau-0.5'
  ),
  CONSTRAINT game_glicko2_rating_events_time_check CHECK (
    processed_at >= rating_period_at
  )
);

CREATE INDEX IF NOT EXISTS idx_game_glicko2_events_player_period
  ON game_glicko2_rating_events(player_key, rating_period_at DESC, game_id);

CREATE OR REPLACE FUNCTION public.guard_glicko2_rating_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM public.games WHERE id = OLD.game_id;
    IF NOT FOUND THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'Glicko-2 game rating evidence is append-only.' USING ERRCODE = '23514';
END
$$;

CREATE OR REPLACE FUNCTION public.validate_glicko2_rating_event_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD; player_state RECORD; opponent_state RECORD; expected_color TEXT; expected_outcome TEXT;
BEGIN
  SELECT * INTO game_row FROM public.games WHERE id = NEW.game_id FOR UPDATE;
  IF NOT FOUND OR game_row.status <> 'finished' OR game_row.finished_at IS NULL
    OR game_row.finish_reason IS NULL OR game_row.result IS NULL
    OR game_row.black_player_key = game_row.white_player_key
    OR NEW.player_key NOT IN (game_row.black_player_key, game_row.white_player_key)
    OR NEW.opponent_key IS DISTINCT FROM CASE NEW.player_key
         WHEN game_row.black_player_key THEN game_row.white_player_key
         ELSE game_row.black_player_key END
    OR NEW.opponent_kind <> 'registered_human'
    OR NEW.opponent_profile_version IS NOT NULL
    OR NEW.game_finished_at IS DISTINCT FROM game_row.finished_at
    OR NEW.finish_reason IS DISTINCT FROM game_row.finish_reason
    OR NEW.game_result IS DISTINCT FROM game_row.result
  THEN RAISE EXCEPTION 'Rating evidence requires one exact registered-human terminal game.' USING ERRCODE = '23514';
  END IF;
  expected_color := CASE NEW.player_key WHEN game_row.black_player_key THEN 'black' ELSE 'white' END;
  expected_outcome := CASE
    WHEN game_row.winner_key IS NULL
      AND game_row.finish_reason IN ('score', 'legacy_score') THEN 'draw'
    WHEN game_row.winner_key = NEW.player_key THEN 'win'
    WHEN game_row.winner_key IN (game_row.black_player_key, game_row.white_player_key) THEN 'loss'
    ELSE NULL END;
  IF expected_outcome IS NULL OR NEW.player_color IS DISTINCT FROM expected_color
    OR NEW.outcome_kind IS DISTINCT FROM expected_outcome
  THEN RAISE EXCEPTION 'Rating outcome contradicts the terminal game.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO player_state FROM public.player_glicko2_ratings
   WHERE player_key = NEW.player_key FOR UPDATE;
  SELECT * INTO opponent_state FROM public.player_glicko2_ratings
   WHERE player_key = NEW.opponent_key;
  IF player_state.player_key IS NULL OR opponent_state.player_key IS NULL
    OR player_state.algorithm_version <> NEW.algorithm_version
    OR player_state.rating IS DISTINCT FROM NEW.rating_before
    OR player_state.rating_deviation IS DISTINCT FROM NEW.rating_deviation_before
    OR player_state.volatility IS DISTINCT FROM NEW.volatility_before
    OR player_state.rated_game_count IS DISTINCT FROM NEW.rated_game_count_before
    OR player_state.last_rating_period_at IS DISTINCT FROM NEW.last_rating_period_at_before
    OR opponent_state.rating IS DISTINCT FROM NEW.opponent_rating
    OR opponent_state.rating_deviation IS DISTINCT FROM NEW.opponent_rating_deviation
  THEN RAISE EXCEPTION 'Rating evidence must begin at the locked global states.' USING ERRCODE = '23514';
  END IF;
  NEW.processed_at := statement_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_glicko2_rating_event_commit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE event_count INT; companion RECORD; player_state RECORD;
BEGIN
  SELECT COUNT(*) INTO event_count FROM public.game_glicko2_rating_events
   WHERE game_id = NEW.game_id;
  SELECT * INTO companion FROM public.game_glicko2_rating_events
   WHERE game_id = NEW.game_id AND player_key = NEW.opponent_key;
  SELECT * INTO player_state FROM public.player_glicko2_ratings
   WHERE player_key = NEW.player_key;
  IF event_count <> 2 OR companion.game_id IS NULL OR player_state.player_key IS NULL
    OR companion.opponent_key IS DISTINCT FROM NEW.player_key
    OR companion.opponent_kind IS DISTINCT FROM NEW.opponent_kind
    OR companion.algorithm_version IS DISTINCT FROM NEW.algorithm_version
    OR companion.rating_period_at IS DISTINCT FROM NEW.rating_period_at
    OR companion.game_finished_at IS DISTINCT FROM NEW.game_finished_at
    OR companion.finish_reason IS DISTINCT FROM NEW.finish_reason
    OR companion.game_result IS DISTINCT FROM NEW.game_result
    OR companion.outcome_kind IS DISTINCT FROM CASE NEW.outcome_kind
         WHEN 'win' THEN 'loss' WHEN 'loss' THEN 'win' ELSE NEW.outcome_kind END
    OR companion.opponent_rating IS DISTINCT FROM NEW.rating_before
    OR companion.opponent_rating_deviation IS DISTINCT FROM NEW.rating_deviation_before
    OR NEW.opponent_rating IS DISTINCT FROM companion.rating_before
    OR NEW.opponent_rating_deviation IS DISTINCT FROM companion.rating_deviation_before
    OR player_state.rating IS DISTINCT FROM NEW.rating_after
    OR player_state.rating_deviation IS DISTINCT FROM NEW.rating_deviation_after
    OR player_state.volatility IS DISTINCT FROM NEW.volatility_after
    OR player_state.rated_game_count IS DISTINCT FROM NEW.rated_game_count_after
    OR player_state.last_rating_period_at IS DISTINCT FROM NEW.last_rating_period_at_after
    OR player_state.algorithm_version IS DISTINCT FROM NEW.algorithm_version
  THEN RAISE EXCEPTION 'Glicko-2 evidence requires one complete paired state transition.' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.guard_glicko2_rating_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_glicko2_rating_event_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_glicko2_rating_event_commit() FROM PUBLIC;

DROP TRIGGER IF EXISTS game_glicko2_rating_events_insert_guard ON game_glicko2_rating_events;
DROP TRIGGER IF EXISTS game_glicko2_rating_events_commit_guard ON game_glicko2_rating_events;
DROP TRIGGER IF EXISTS game_glicko2_rating_events_immutable_guard ON game_glicko2_rating_events;
DROP TRIGGER IF EXISTS game_glicko2_rating_events_truncate_guard ON game_glicko2_rating_events;
CREATE TRIGGER game_glicko2_rating_events_insert_guard
  BEFORE INSERT ON game_glicko2_rating_events FOR EACH ROW
  EXECUTE FUNCTION public.validate_glicko2_rating_event_insert();
CREATE CONSTRAINT TRIGGER game_glicko2_rating_events_commit_guard
  AFTER INSERT ON game_glicko2_rating_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_glicko2_rating_event_commit();
CREATE TRIGGER game_glicko2_rating_events_immutable_guard
  BEFORE UPDATE OR DELETE ON game_glicko2_rating_events FOR EACH ROW
  EXECUTE FUNCTION public.guard_glicko2_rating_event_mutation();
CREATE TRIGGER game_glicko2_rating_events_truncate_guard
  BEFORE TRUNCATE ON game_glicko2_rating_events FOR EACH STATEMENT
  EXECUTE FUNCTION public.guard_glicko2_rating_event_mutation();

ALTER TABLE player_glicko2_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_glicko2_rating_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON player_glicko2_ratings FROM PUBLIC;
REVOKE ALL ON game_glicko2_rating_events FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON player_glicko2_ratings, game_glicko2_rating_events FROM anon;
    REVOKE ALL ON FUNCTION public.guard_glicko2_rating_event_mutation(),
      public.validate_glicko2_rating_event_insert(),
      public.validate_glicko2_rating_event_commit() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON player_glicko2_ratings, game_glicko2_rating_events FROM authenticated;
    REVOKE ALL ON FUNCTION public.guard_glicko2_rating_event_mutation(),
      public.validate_glicko2_rating_event_insert(),
      public.validate_glicko2_rating_event_commit() FROM authenticated;
  END IF;
END
$$;
