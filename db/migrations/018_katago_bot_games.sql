CREATE TABLE IF NOT EXISTS katago_workers (
  worker_id TEXT PRIMARY KEY,
  capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  engine_version TEXT NOT NULL,
  model_name TEXT NOT NULL,
  ready BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (cardinality(capabilities) > 0)
);

CREATE TABLE IF NOT EXISTS game_bots (
  game_id UUID PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  bot_player_key TEXT UNIQUE NOT NULL CHECK (bot_player_key LIKE 'bot:%'),
  display_name TEXT NOT NULL CHECK (
    char_length(display_name) BETWEEN 2 AND 40
    AND display_name = BTRIM(display_name)
  ),
  color TEXT NOT NULL CHECK (color IN ('black', 'white')),
  target_rating INT NOT NULL CHECK (target_rating BETWEEN 100 AND 3000),
  visits_per_turn INT NOT NULL CHECK (visits_per_turn BETWEEN 1 AND 2000),
  candidate_limit INT NOT NULL CHECK (candidate_limit BETWEEN 1 AND 12),
  temperature DOUBLE PRECISION NOT NULL CHECK (temperature BETWEEN 0.05 AND 3),
  scheduled_game_version INT NOT NULL DEFAULT -1 CHECK (scheduled_game_version >= -1),
  next_move_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  failure_count INT NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 1000),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_katago_workers_ready
  ON katago_workers(last_seen_at DESC)
  WHERE ready;
CREATE INDEX IF NOT EXISTS idx_game_bots_claim
  ON game_bots(next_move_at, game_id)
  WHERE lease_expires_at IS NULL;

ALTER TABLE katago_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_bots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katago_workers, game_bots FROM PUBLIC;

DO $gostone_bot_access$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON katago_workers, game_bots FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON katago_workers, game_bots FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON katago_workers, game_bots TO gostone_app;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'katago_workers'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON katago_workers
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'game_bots'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON game_bots
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END
$gostone_bot_access$;
