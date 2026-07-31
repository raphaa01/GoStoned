CREATE TABLE IF NOT EXISTS game_analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_version INT NOT NULL CHECK (game_version > 0),
  requested_by_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  input JSONB NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  result JSONB CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  error_code TEXT,
  error_message TEXT,
  worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT game_analysis_jobs_game_version_unique UNIQUE (game_id, game_version),
  CONSTRAINT game_analysis_jobs_result_shape_check CHECK (
    (status = 'completed' AND result IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status <> 'completed' AND result IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_game_analysis_jobs_claim
  ON game_analysis_jobs(status, created_at, id)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_game_analysis_jobs_game
  ON game_analysis_jobs(game_id, game_version DESC);

ALTER TABLE game_analysis_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game_analysis_jobs FROM PUBLIC;

DO $gostone_analysis_access$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON game_analysis_jobs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON game_analysis_jobs FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON game_analysis_jobs TO gostone_app;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'game_analysis_jobs'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON game_analysis_jobs
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END
$gostone_analysis_access$;
