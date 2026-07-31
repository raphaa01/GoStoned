-- Calibrated bots are rating opponents only through immutable accepted
-- profiles, append-only activation, exact per-game binding, and execution logs.
-- No profile or activation is seeded: production remains fail-closed until
-- genuine calibration evidence is independently accepted.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS calibrated_bot_profiles (
  profile_id TEXT PRIMARY KEY CHECK (profile_id ~ '^bot:[a-z0-9][a-z0-9-]{1,62}:v[1-9][0-9]*$'),
  profile_contract_version TEXT NOT NULL CHECK (profile_contract_version = 'calibrated-bot-profile-v1'),
  profile_fingerprint TEXT NOT NULL UNIQUE CHECK (profile_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  transparent_name TEXT NOT NULL CHECK (LENGTH(transparent_name) BETWEEN 1 AND 160),
  engine_family TEXT NOT NULL CHECK (LENGTH(engine_family) BETWEEN 1 AND 160),
  engine_version TEXT NOT NULL CHECK (LENGTH(engine_version) BETWEEN 1 AND 160),
  model_version TEXT NOT NULL CHECK (LENGTH(model_version) BETWEEN 1 AND 160),
  config_version TEXT NOT NULL CHECK (LENGTH(config_version) BETWEEN 1 AND 160),
  fixed_rating NUMERIC(12,6) NOT NULL CHECK (fixed_rating BETWEEN -10000 AND 10000),
  fixed_rating_deviation NUMERIC(12,6) NOT NULL CHECK (fixed_rating_deviation > 0 AND fixed_rating_deviation <= 350),
  handicap_mode TEXT NOT NULL CHECK (handicap_mode IN ('even', 'verified-handicap')),
  acceptance_policy_version TEXT NOT NULL CHECK (acceptance_policy_version = 'bot-calibration-acceptance-v1'),
  source_revision TEXT NOT NULL CHECK (source_revision ~ '^[0-9a-f]{40}$'),
  dataset_digest TEXT NOT NULL CHECK (dataset_digest ~ '^sha256:[0-9a-f]{64}$'),
  runner_digest TEXT NOT NULL CHECK (runner_digest ~ '^sha256:[0-9a-f]{64}$'),
  reproduction_command TEXT NOT NULL CHECK (LENGTH(reproduction_command) BETWEEN 1 AND 1000),
  calibration_games INT NOT NULL CHECK (calibration_games >= 500),
  holdout_games INT NOT NULL CHECK (holdout_games >= 100 AND holdout_games <= calibration_games),
  distinct_registered_humans INT NOT NULL CHECK (distinct_registered_humans >= 100 AND distinct_registered_humans <= calibration_games),
  estimated_rating NUMERIC(12,6) NOT NULL,
  standard_error NUMERIC(12,6) NOT NULL CHECK (standard_error > 0 AND standard_error <= 75),
  unresolved_audit_findings INT NOT NULL CHECK (unresolved_audit_findings = 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CHECK (ABS(fixed_rating - estimated_rating) <= 100),
  CHECK (fixed_rating_deviation >= standard_error),
  UNIQUE (profile_id, profile_fingerprint)
);

CREATE TABLE IF NOT EXISTS calibrated_bot_profile_configurations (
  profile_id TEXT NOT NULL REFERENCES calibrated_bot_profiles(profile_id) ON DELETE RESTRICT,
  configuration_key TEXT NOT NULL CHECK (configuration_key ~ '^[0-9a-f]{64}$'),
  board_size INT NOT NULL CHECK (board_size IN (9,13,19)),
  time_control TEXT NOT NULL CHECK (time_control IN ('blitz','rapid','classic')),
  rules_profile TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  komi NUMERIC(4,1) NOT NULL,
  handicap INT NOT NULL CHECK (handicap >= 0),
  calibration_games INT NOT NULL CHECK (calibration_games >= 50),
  PRIMARY KEY (profile_id, configuration_key),
  UNIQUE (profile_id,board_size,time_control,rules_profile,rules_version,komi,handicap)
);

CREATE TABLE IF NOT EXISTS calibrated_bot_profile_activation_events (
  activation_id BIGSERIAL PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES calibrated_bot_profiles(profile_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('activate','deactivate')),
  reason TEXT NOT NULL CHECK (LENGTH(reason) BETWEEN 1 AND 500),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);

ALTER TABLE game_bots
  ADD COLUMN IF NOT EXISTS rating_mode TEXT NOT NULL DEFAULT 'unrated' CHECK (
    rating_mode IN ('unrated','calibrated-v1')
  );

CREATE TABLE IF NOT EXISTS game_calibrated_bot_bindings (
  game_id UUID PRIMARY KEY REFERENCES games(id) ON DELETE RESTRICT,
  bot_player_key TEXT NOT NULL,
  bot_color TEXT NOT NULL CHECK (bot_color IN ('black','white')),
  human_player_key TEXT NOT NULL CHECK (human_player_key LIKE 'user:%'),
  profile_id TEXT NOT NULL,
  activation_id BIGINT NOT NULL REFERENCES calibrated_bot_profile_activation_events(activation_id) ON DELETE RESTRICT,
  binding_version TEXT NOT NULL CHECK (binding_version = 'bot-opponent-binding-v1'),
  profile_contract_version TEXT NOT NULL,
  profile_fingerprint TEXT NOT NULL,
  engine_family TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  config_version TEXT NOT NULL,
  opponent_rating NUMERIC(12,6) NOT NULL,
  opponent_rating_deviation NUMERIC(12,6) NOT NULL,
  configuration_key TEXT NOT NULL,
  credit_mode TEXT NOT NULL CHECK (credit_mode = 'fixed-versioned-profile'),
  rating_credit_policy_version TEXT NOT NULL CHECK (rating_credit_policy_version = 'calibrated-bot-rating-credit-v1'),
  bound_game_version INT NOT NULL CHECK (bound_game_version = 0),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (game_id,bot_player_key),
  FOREIGN KEY (profile_id,profile_fingerprint)
    REFERENCES calibrated_bot_profiles(profile_id,profile_fingerprint) ON DELETE RESTRICT,
  FOREIGN KEY (profile_id,configuration_key)
    REFERENCES calibrated_bot_profile_configurations(profile_id,configuration_key) ON DELETE RESTRICT,
  CHECK (bot_player_key LIKE 'bot:%' AND bot_player_key <> human_player_key)
);

CREATE TABLE IF NOT EXISTS game_calibrated_bot_actions (
  game_id UUID NOT NULL REFERENCES game_calibrated_bot_bindings(game_id) ON DELETE RESTRICT,
  action_sequence INT NOT NULL CHECK (action_sequence > 0),
  request_identity TEXT NOT NULL CHECK (LENGTH(request_identity) BETWEEN 1 AND 200),
  action_kind TEXT NOT NULL CHECK (action_kind IN ('move','pass','resign')),
  move_number INT CHECK (move_number IS NULL OR move_number > 0),
  x INT CHECK (x IS NULL OR x BETWEEN 0 AND 18),
  y INT CHECK (y IS NULL OR y BETWEEN 0 AND 18),
  profile_id TEXT NOT NULL,
  profile_fingerprint TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  config_version TEXT NOT NULL,
  worker_id TEXT NOT NULL CHECK (LENGTH(worker_id) BETWEEN 1 AND 160),
  completed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (game_id,action_sequence),
  UNIQUE (game_id,request_identity),
  CHECK (
    (action_kind = 'move' AND move_number IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL)
    OR (action_kind IN ('pass','resign') AND x IS NULL AND y IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calibrated_bot_action_move_once
  ON game_calibrated_bot_actions(game_id,move_number)
  WHERE action_kind IN ('move','pass');
CREATE UNIQUE INDEX IF NOT EXISTS idx_calibrated_bot_action_resign_once
  ON game_calibrated_bot_actions(game_id)
  WHERE action_kind = 'resign';

ALTER TABLE game_glicko2_rating_events
  ADD COLUMN IF NOT EXISTS opponent_profile_id TEXT,
  ADD COLUMN IF NOT EXISTS opponent_profile_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS opponent_binding_version TEXT,
  ADD COLUMN IF NOT EXISTS opponent_configuration_key TEXT,
  ADD COLUMN IF NOT EXISTS opponent_credit_mode TEXT;

ALTER TABLE game_glicko2_rating_events
  DROP CONSTRAINT IF EXISTS game_glicko2_rating_events_opponent_check;
ALTER TABLE game_glicko2_rating_events
  ADD CONSTRAINT game_glicko2_rating_events_opponent_check CHECK (COALESCE((
    (opponent_kind = 'registered_human' AND opponent_key LIKE 'user:%'
      AND opponent_profile_version IS NULL AND opponent_profile_id IS NULL
      AND opponent_profile_fingerprint IS NULL AND opponent_binding_version IS NULL
      AND opponent_configuration_key IS NULL AND opponent_credit_mode IS NULL)
    OR
    (opponent_kind = 'calibrated_bot' AND opponent_key LIKE 'bot:%'
      AND opponent_profile_version IS NOT NULL AND opponent_profile_id IS NOT NULL
      AND opponent_profile_fingerprint ~ '^sha256:[0-9a-f]{64}$'
      AND opponent_binding_version = 'bot-opponent-binding-v1'
      AND opponent_configuration_key ~ '^[0-9a-f]{64}$'
      AND opponent_credit_mode = 'fixed-versioned-profile')
  ), FALSE));

CREATE OR REPLACE FUNCTION public.guard_calibrated_bot_evidence_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Calibrated bot evidence is append-only.' USING ERRCODE = '23514';
END
$$;

CREATE OR REPLACE FUNCTION public.validate_calibrated_bot_activation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE previous_action TEXT; profile_row RECORD; configuration_total INT;
BEGIN
  SELECT * INTO profile_row FROM public.calibrated_bot_profiles
   WHERE profile_id = NEW.profile_id FOR UPDATE;
  SELECT action INTO previous_action FROM public.calibrated_bot_profile_activation_events
   WHERE profile_id = NEW.profile_id ORDER BY activation_id DESC LIMIT 1 FOR UPDATE;
  SELECT COALESCE(SUM(calibration_games),0) INTO configuration_total
    FROM public.calibrated_bot_profile_configurations WHERE profile_id = NEW.profile_id;
  IF profile_row.profile_id IS NULL OR configuration_total <> profile_row.calibration_games
    OR (NEW.action = 'activate' AND previous_action = 'activate')
    OR (NEW.action = 'deactivate' AND previous_action IS DISTINCT FROM 'activate')
  THEN RAISE EXCEPTION 'Bot activation requires complete accepted calibration and monotonic state.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_calibrated_bot_binding()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD; bot_row RECORD; queue_row RECORD; profile_row RECORD; config_row RECORD; activation_row RECORD;
BEGIN
  SELECT * INTO game_row FROM public.games WHERE id = NEW.game_id FOR UPDATE;
  SELECT * INTO bot_row FROM public.game_bots WHERE game_id = NEW.game_id FOR UPDATE;
  SELECT * INTO profile_row FROM public.calibrated_bot_profiles WHERE profile_id = NEW.profile_id;
  SELECT * INTO config_row FROM public.calibrated_bot_profile_configurations
   WHERE profile_id = NEW.profile_id AND configuration_key = NEW.configuration_key;
  SELECT * INTO queue_row FROM public.matchmaking_queue
   WHERE player_key = NEW.human_player_key AND game_id = NEW.game_id AND status = 'matched';
  SELECT * INTO activation_row FROM public.calibrated_bot_profile_activation_events
   WHERE activation_id = NEW.activation_id AND profile_id = NEW.profile_id;
  IF game_row.id IS NULL OR game_row.status <> 'active' OR game_row.version <> 0
    OR EXISTS (SELECT 1 FROM public.moves WHERE game_id = NEW.game_id)
    OR bot_row.bot_player_key IS DISTINCT FROM NEW.bot_player_key
    OR bot_row.color IS DISTINCT FROM NEW.bot_color OR bot_row.rating_mode <> 'calibrated-v1'
    OR NEW.human_player_key IS DISTINCT FROM CASE NEW.bot_color
         WHEN 'black' THEN game_row.white_player_key ELSE game_row.black_player_key END
    OR NEW.bot_player_key IS DISTINCT FROM CASE NEW.bot_color
         WHEN 'black' THEN game_row.black_player_key ELSE game_row.white_player_key END
    OR queue_row.player_key IS NULL OR queue_row.match_pool <> 'registered-rated'
    OR queue_row.bot_match_preference <> 'calibrated-rated-after-wait'
    OR queue_row.matchmaking_policy_version <> 'adaptive-global-glicko-match-v1'
    OR queue_row.board_size <> game_row.board_size
    OR queue_row.time_control <> game_row.time_control
    OR queue_row.rules_snapshot <> game_row.rules
    OR queue_row.rules_profile_snapshot <> game_row.rules_profile
    OR queue_row.scoring_method_snapshot <> game_row.scoring_method
    OR queue_row.komi_snapshot <> game_row.komi
    OR queue_row.handicap_snapshot <> game_row.handicap
    OR profile_row.profile_id IS NULL OR activation_row.action <> 'activate'
    OR EXISTS (SELECT 1 FROM public.calibrated_bot_profile_activation_events later
                WHERE later.profile_id = NEW.profile_id AND later.activation_id > NEW.activation_id)
    OR profile_row.profile_contract_version IS DISTINCT FROM NEW.profile_contract_version
    OR profile_row.profile_fingerprint IS DISTINCT FROM NEW.profile_fingerprint
    OR profile_row.engine_family IS DISTINCT FROM NEW.engine_family
    OR profile_row.engine_version IS DISTINCT FROM NEW.engine_version
    OR profile_row.model_version IS DISTINCT FROM NEW.model_version
    OR profile_row.config_version IS DISTINCT FROM NEW.config_version
    OR profile_row.fixed_rating IS DISTINCT FROM NEW.opponent_rating
    OR profile_row.fixed_rating_deviation IS DISTINCT FROM NEW.opponent_rating_deviation
    OR config_row.profile_id IS NULL OR config_row.board_size <> game_row.board_size
    OR config_row.time_control <> game_row.time_control
    OR config_row.rules_profile <> game_row.rules_profile
    OR config_row.rules_version <> queue_row.rules_version_snapshot
    OR config_row.komi <> game_row.komi OR config_row.handicap <> game_row.handicap
  THEN RAISE EXCEPTION 'Rated bot binding does not match accepted profile, activation, game, and execution identity.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_calibrated_bot_action_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE binding_row RECORD; game_row RECORD;
BEGIN
  SELECT * INTO binding_row FROM public.game_calibrated_bot_bindings
   WHERE game_id = NEW.game_id FOR UPDATE;
  SELECT * INTO game_row FROM public.games WHERE id = NEW.game_id FOR UPDATE;
  IF binding_row.game_id IS NULL OR NEW.completed_at < binding_row.bound_at
    OR NEW.completed_at > statement_timestamp()
    OR NEW.profile_id IS DISTINCT FROM binding_row.profile_id
    OR NEW.profile_fingerprint IS DISTINCT FROM binding_row.profile_fingerprint
    OR NEW.engine_version IS DISTINCT FROM binding_row.engine_version
    OR NEW.model_version IS DISTINCT FROM binding_row.model_version
    OR NEW.config_version IS DISTINCT FROM binding_row.config_version
    OR (
      NEW.action_kind IN ('move','pass') AND NOT EXISTS (
        SELECT 1 FROM public.moves move
         WHERE move.game_id = NEW.game_id AND move.move_number = NEW.move_number
           AND move.color = binding_row.bot_color
           AND NEW.action_kind = CASE WHEN move.is_pass THEN 'pass' ELSE 'move' END
           AND NEW.x IS NOT DISTINCT FROM move.x AND NEW.y IS NOT DISTINCT FROM move.y
      )
    )
    OR (
      NEW.action_kind = 'resign' AND NOT (
        game_row.status = 'finished' AND game_row.finish_reason = 'resignation'
        AND game_row.winner_key = binding_row.human_player_key
      )
    )
  THEN RAISE EXCEPTION 'Calibrated bot action does not match its immutable binding and persisted game action.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_bound_game_bot_identity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.game_calibrated_bot_bindings binding WHERE binding.game_id = OLD.game_id)
    AND (NEW.bot_player_key IS DISTINCT FROM OLD.bot_player_key
      OR NEW.color IS DISTINCT FROM OLD.color
      OR NEW.rating_mode IS DISTINCT FROM OLD.rating_mode)
  THEN RAISE EXCEPTION 'A calibrated game cannot change its bound bot identity or rating mode.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS calibrated_bot_activation_insert_guard ON calibrated_bot_profile_activation_events;
CREATE TRIGGER calibrated_bot_activation_insert_guard BEFORE INSERT
  ON calibrated_bot_profile_activation_events FOR EACH ROW
  EXECUTE FUNCTION public.validate_calibrated_bot_activation();
DROP TRIGGER IF EXISTS calibrated_bot_binding_insert_guard ON game_calibrated_bot_bindings;
CREATE TRIGGER calibrated_bot_binding_insert_guard BEFORE INSERT
  ON game_calibrated_bot_bindings FOR EACH ROW
  EXECUTE FUNCTION public.validate_calibrated_bot_binding();
DROP TRIGGER IF EXISTS calibrated_bot_action_insert_guard ON game_calibrated_bot_actions;
CREATE TRIGGER calibrated_bot_action_insert_guard BEFORE INSERT
  ON game_calibrated_bot_actions FOR EACH ROW
  EXECUTE FUNCTION public.validate_calibrated_bot_action_insert();
DROP TRIGGER IF EXISTS bound_game_bot_identity_guard ON game_bots;
CREATE TRIGGER bound_game_bot_identity_guard BEFORE UPDATE ON game_bots
  FOR EACH ROW EXECUTE FUNCTION public.guard_bound_game_bot_identity();

DO $$
DECLARE relation_name TEXT;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'calibrated_bot_profiles','calibrated_bot_profile_configurations',
    'calibrated_bot_profile_activation_events','game_calibrated_bot_bindings',
    'game_calibrated_bot_actions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS calibrated_bot_immutable_guard ON public.%I', relation_name);
    EXECUTE format('DROP TRIGGER IF EXISTS calibrated_bot_truncate_guard ON public.%I', relation_name);
    EXECUTE format('CREATE TRIGGER calibrated_bot_immutable_guard BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_calibrated_bot_evidence_mutation()', relation_name);
    EXECUTE format('CREATE TRIGGER calibrated_bot_truncate_guard BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guard_calibrated_bot_evidence_mutation()', relation_name);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_calibrated_bot_rating_event_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD; binding_row RECORD; player_state RECORD; expected_color TEXT; expected_outcome TEXT;
BEGIN
  SELECT * INTO game_row FROM public.games WHERE id = NEW.game_id FOR UPDATE;
  SELECT * INTO binding_row FROM public.game_calibrated_bot_bindings
   WHERE game_id = NEW.game_id FOR UPDATE;
  expected_color := CASE NEW.player_key WHEN game_row.black_player_key THEN 'black'
                    WHEN game_row.white_player_key THEN 'white' ELSE NULL END;
  expected_outcome := CASE
    WHEN game_row.finish_reason IN ('japanese_no_result','japanese_repetition')
      AND game_row.winner_key IS NULL THEN 'no_result'
    WHEN game_row.winner_key IS NULL
      AND game_row.finish_reason IN ('score','legacy_score','japanese_adjudication') THEN 'draw'
    WHEN game_row.winner_key = NEW.player_key THEN 'win'
    WHEN game_row.winner_key IN (game_row.black_player_key,game_row.white_player_key) THEN 'loss'
    ELSE NULL END;
  IF game_row.status <> 'finished' OR game_row.finished_at IS NULL
    OR binding_row.game_id IS NULL OR binding_row.human_player_key <> NEW.player_key
    OR binding_row.bot_player_key <> NEW.opponent_key
    OR NEW.player_color IS DISTINCT FROM expected_color
    OR NEW.outcome_kind IS DISTINCT FROM expected_outcome
    OR NEW.game_finished_at IS DISTINCT FROM game_row.finished_at
    OR NEW.finish_reason IS DISTINCT FROM game_row.finish_reason
    OR NEW.game_result IS DISTINCT FROM game_row.result
    OR NEW.opponent_profile_version IS DISTINCT FROM binding_row.profile_contract_version
    OR NEW.opponent_profile_id IS DISTINCT FROM binding_row.profile_id
    OR NEW.opponent_profile_fingerprint IS DISTINCT FROM binding_row.profile_fingerprint
    OR NEW.opponent_binding_version IS DISTINCT FROM binding_row.binding_version
    OR NEW.opponent_configuration_key IS DISTINCT FROM binding_row.configuration_key
    OR NEW.opponent_credit_mode IS DISTINCT FROM binding_row.credit_mode
    OR NEW.opponent_rating IS DISTINCT FROM binding_row.opponent_rating
    OR NEW.opponent_rating_deviation IS DISTINCT FROM binding_row.opponent_rating_deviation
    OR EXISTS (
      SELECT 1 FROM public.moves bot_move
       WHERE bot_move.game_id = NEW.game_id AND bot_move.color = binding_row.bot_color
         AND NOT EXISTS (
           SELECT 1 FROM public.game_calibrated_bot_actions action
            WHERE action.game_id = NEW.game_id AND action.move_number = bot_move.move_number
              AND action.action_kind = CASE WHEN bot_move.x IS NULL THEN 'pass' ELSE 'move' END
              AND action.x IS NOT DISTINCT FROM bot_move.x AND action.y IS NOT DISTINCT FROM bot_move.y
              AND action.profile_id = binding_row.profile_id
              AND action.profile_fingerprint = binding_row.profile_fingerprint
              AND action.engine_version = binding_row.engine_version
              AND action.model_version = binding_row.model_version
              AND action.config_version = binding_row.config_version
         )
    )
  THEN RAISE EXCEPTION 'Calibrated bot rating evidence contradicts the bound game execution.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO player_state FROM public.player_glicko2_ratings
   WHERE player_key = NEW.player_key FOR UPDATE;
  IF player_state.player_key IS NULL OR player_state.algorithm_version <> NEW.algorithm_version
    OR player_state.rating IS DISTINCT FROM NEW.rating_before
    OR player_state.rating_deviation IS DISTINCT FROM NEW.rating_deviation_before
    OR player_state.volatility IS DISTINCT FROM NEW.volatility_before
    OR player_state.rated_game_count IS DISTINCT FROM NEW.rated_game_count_before
    OR player_state.last_rating_period_at IS DISTINCT FROM NEW.last_rating_period_at_before
  THEN RAISE EXCEPTION 'Bot rating evidence must begin at the locked human global state.' USING ERRCODE = '23514';
  END IF;
  NEW.processed_at := statement_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_calibrated_bot_rating_event_commit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE event_count INT; player_state RECORD;
BEGIN
  SELECT COUNT(*) INTO event_count FROM public.game_glicko2_rating_events
   WHERE game_id = NEW.game_id;
  SELECT * INTO player_state FROM public.player_glicko2_ratings
   WHERE player_key = NEW.player_key;
  IF event_count <> 1 OR player_state.player_key IS NULL
    OR player_state.rating IS DISTINCT FROM NEW.rating_after
    OR player_state.rating_deviation IS DISTINCT FROM NEW.rating_deviation_after
    OR player_state.volatility IS DISTINCT FROM NEW.volatility_after
    OR player_state.rated_game_count IS DISTINCT FROM NEW.rated_game_count_after
    OR player_state.last_rating_period_at IS DISTINCT FROM NEW.last_rating_period_at_after
    OR player_state.algorithm_version IS DISTINCT FROM NEW.algorithm_version
  THEN RAISE EXCEPTION 'Calibrated bot evidence requires one complete human state transition.' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS game_glicko2_rating_events_insert_guard ON game_glicko2_rating_events;
DROP TRIGGER IF EXISTS game_glicko2_rating_events_commit_guard ON game_glicko2_rating_events;
CREATE TRIGGER game_glicko2_rating_events_insert_guard
  BEFORE INSERT ON game_glicko2_rating_events FOR EACH ROW
  WHEN (NEW.opponent_kind = 'registered_human')
  EXECUTE FUNCTION public.validate_glicko2_rating_event_insert();
CREATE CONSTRAINT TRIGGER game_glicko2_rating_events_commit_guard
  AFTER INSERT ON game_glicko2_rating_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.opponent_kind = 'registered_human')
  EXECUTE FUNCTION public.validate_glicko2_rating_event_commit();
CREATE TRIGGER game_glicko2_calibrated_bot_event_insert_guard
  BEFORE INSERT ON game_glicko2_rating_events FOR EACH ROW
  WHEN (NEW.opponent_kind = 'calibrated_bot')
  EXECUTE FUNCTION public.validate_calibrated_bot_rating_event_insert();
CREATE CONSTRAINT TRIGGER game_glicko2_calibrated_bot_event_commit_guard
  AFTER INSERT ON game_glicko2_rating_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.opponent_kind = 'calibrated_bot')
  EXECUTE FUNCTION public.validate_calibrated_bot_rating_event_commit();

CREATE OR REPLACE FUNCTION public.validate_glicko2_state_transition()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.game_glicko2_rating_events event
     WHERE event.player_key = OLD.player_key
       AND event.rating_before IS NOT DISTINCT FROM OLD.rating
       AND event.rating_deviation_before IS NOT DISTINCT FROM OLD.rating_deviation
       AND event.volatility_before IS NOT DISTINCT FROM OLD.volatility
       AND event.rated_game_count_before IS NOT DISTINCT FROM OLD.rated_game_count
       AND event.last_rating_period_at_before IS NOT DISTINCT FROM OLD.last_rating_period_at
       AND event.rating_after IS NOT DISTINCT FROM NEW.rating
       AND event.rating_deviation_after IS NOT DISTINCT FROM NEW.rating_deviation
       AND event.volatility_after IS NOT DISTINCT FROM NEW.volatility
       AND event.rated_game_count_after IS NOT DISTINCT FROM NEW.rated_game_count
       AND event.last_rating_period_at_after IS NOT DISTINCT FROM NEW.last_rating_period_at
       AND event.algorithm_version IS NOT DISTINCT FROM NEW.algorithm_version
       AND event.rating_period_at > OLD.last_rating_period_at
  ) THEN
    RAISE EXCEPTION 'Global rating state changes require matching immutable game evidence.' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS player_glicko2_ratings_transition_guard ON player_glicko2_ratings;
CREATE TRIGGER player_glicko2_ratings_transition_guard
  BEFORE UPDATE ON player_glicko2_ratings FOR EACH ROW
  EXECUTE FUNCTION public.validate_glicko2_state_transition();

ALTER TABLE calibrated_bot_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibrated_bot_profile_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibrated_bot_profile_activation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_calibrated_bot_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_calibrated_bot_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON calibrated_bot_profiles,calibrated_bot_profile_configurations,
  calibrated_bot_profile_activation_events,game_calibrated_bot_bindings,
  game_calibrated_bot_actions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_calibrated_bot_evidence_mutation(),
  public.validate_calibrated_bot_activation(),public.validate_calibrated_bot_binding(),
  public.validate_calibrated_bot_action_insert(),public.guard_bound_game_bot_identity(),
  public.validate_calibrated_bot_rating_event_insert(),
  public.validate_calibrated_bot_rating_event_commit() FROM PUBLIC;

DO $$
DECLARE relation_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT ON calibrated_bot_profiles,calibrated_bot_profile_configurations,
      calibrated_bot_profile_activation_events TO gostone_app;
    GRANT SELECT,INSERT ON game_calibrated_bot_bindings,game_calibrated_bot_actions TO gostone_app;
    FOREACH relation_name IN ARRAY ARRAY[
      'calibrated_bot_profiles','calibrated_bot_profile_configurations',
      'calibrated_bot_profile_activation_events','game_calibrated_bot_bindings',
      'game_calibrated_bot_actions'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public'
          AND tablename = relation_name AND policyname = 'gostone_app_server_read'
      ) THEN
        EXECUTE format('CREATE POLICY gostone_app_server_read ON public.%I FOR SELECT TO gostone_app USING (true)', relation_name);
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='game_calibrated_bot_bindings' AND policyname='gostone_app_server_insert') THEN
      CREATE POLICY gostone_app_server_insert ON game_calibrated_bot_bindings
        FOR INSERT TO gostone_app WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='game_calibrated_bot_actions' AND policyname='gostone_app_server_insert') THEN
      CREATE POLICY gostone_app_server_insert ON game_calibrated_bot_actions
        FOR INSERT TO gostone_app WITH CHECK (true);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON calibrated_bot_profiles,calibrated_bot_profile_configurations,
      calibrated_bot_profile_activation_events,game_calibrated_bot_bindings,
      game_calibrated_bot_actions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON calibrated_bot_profiles,calibrated_bot_profile_configurations,
      calibrated_bot_profile_activation_events,game_calibrated_bot_bindings,
      game_calibrated_bot_actions FROM authenticated;
  END IF;
END
$$;
