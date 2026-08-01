-- Browser-local GoStone model bindings and immutable rated action evidence.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE game_bots DROP CONSTRAINT IF EXISTS game_bots_rating_mode_check;
ALTER TABLE game_bots ADD CONSTRAINT game_bots_rating_mode_check
  CHECK (rating_mode IN ('unrated','calibrated-v1','browser-v1'));

CREATE TABLE IF NOT EXISTS game_browser_bot_bindings (
  game_id UUID PRIMARY KEY REFERENCES games(id) ON DELETE RESTRICT,
  bot_player_key TEXT NOT NULL CHECK (bot_player_key LIKE 'bot:%'),
  bot_color TEXT NOT NULL CHECK (bot_color IN ('black','white')),
  human_player_key TEXT NOT NULL CHECK (human_player_key LIKE 'user:%'),
  model_contract_version TEXT NOT NULL CHECK (model_contract_version = 'gostone-browser-bot-v1'),
  model_version TEXT NOT NULL CHECK (model_version ~ '^v[1-9][0-9]*$'),
  model_sha256 TEXT NOT NULL CHECK (model_sha256 ~ '^[0-9a-f]{64}$'),
  binding_version TEXT NOT NULL CHECK (binding_version = 'browser-bot-binding-v1'),
  configuration_key TEXT NOT NULL CHECK (configuration_key ~ '^[0-9a-f]{64}$'),
  opponent_rating NUMERIC(12,6) NOT NULL CHECK (opponent_rating BETWEEN 100 AND 3000),
  opponent_rating_deviation NUMERIC(12,6) NOT NULL
    CHECK (opponent_rating_deviation > 0 AND opponent_rating_deviation <= 350),
  strength_value NUMERIC(8,7) NOT NULL CHECK (strength_value BETWEEN 0 AND 1),
  credit_mode TEXT NOT NULL CHECK (credit_mode = 'fixed-versioned-profile'),
  bound_game_version INT NOT NULL CHECK (bound_game_version = 0),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (game_id,bot_player_key),
  CHECK (bot_player_key <> human_player_key)
);

CREATE TABLE IF NOT EXISTS game_browser_bot_actions (
  game_id UUID NOT NULL REFERENCES game_browser_bot_bindings(game_id) ON DELETE RESTRICT,
  action_sequence INT NOT NULL CHECK (action_sequence > 0),
  request_identity TEXT NOT NULL CHECK (LENGTH(request_identity) BETWEEN 1 AND 200),
  action_kind TEXT NOT NULL CHECK (action_kind IN ('move','pass')),
  move_number INT NOT NULL CHECK (move_number > 0),
  x INT CHECK (x IS NULL OR x BETWEEN 0 AND 18),
  y INT CHECK (y IS NULL OR y BETWEEN 0 AND 18),
  model_contract_version TEXT NOT NULL CHECK (model_contract_version = 'gostone-browser-bot-v1'),
  model_version TEXT NOT NULL,
  model_sha256 TEXT NOT NULL CHECK (model_sha256 ~ '^[0-9a-f]{64}$'),
  worker_id TEXT NOT NULL CHECK (worker_id = 'browser'),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (game_id,action_sequence),
  UNIQUE (game_id,request_identity),
  CHECK (
    (action_kind = 'move' AND x IS NOT NULL AND y IS NOT NULL)
    OR (action_kind = 'pass' AND x IS NULL AND y IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_browser_bot_action_move_once
  ON game_browser_bot_actions(game_id,move_number);

ALTER TABLE game_glicko2_rating_events
  DROP CONSTRAINT IF EXISTS game_glicko2_rating_events_opponent_kind_check;
ALTER TABLE game_glicko2_rating_events
  ADD CONSTRAINT game_glicko2_rating_events_opponent_kind_check
  CHECK (opponent_kind IN ('registered_human','calibrated_bot','browser_bot'));

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
    OR
    (opponent_kind = 'browser_bot' AND opponent_key LIKE 'bot:%'
      AND opponent_profile_version = 'gostone-browser-bot-v1'
      AND opponent_profile_id ~ '^bot:gostone-browser:v[1-9][0-9]*$'
      AND opponent_profile_fingerprint ~ '^sha256:[0-9a-f]{64}$'
      AND opponent_binding_version = 'browser-bot-binding-v1'
      AND opponent_configuration_key ~ '^[0-9a-f]{64}$'
      AND opponent_credit_mode = 'fixed-versioned-profile')
  ), FALSE));

ALTER TABLE game_browser_bot_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_browser_bot_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game_browser_bot_bindings,game_browser_bot_actions FROM PUBLIC;

DO $browser_bot_access$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT,INSERT ON game_browser_bot_bindings,game_browser_bot_actions TO gostone_app;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='game_browser_bot_bindings' AND policyname='gostone_app_server_access') THEN
      CREATE POLICY gostone_app_server_access ON game_browser_bot_bindings
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='game_browser_bot_actions' AND policyname='gostone_app_server_access') THEN
      CREATE POLICY gostone_app_server_access ON game_browser_bot_actions
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON game_browser_bot_bindings,game_browser_bot_actions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON game_browser_bot_bindings,game_browser_bot_actions FROM authenticated;
  END IF;
END
$browser_bot_access$;
