-- Durable scoring jobs adapt GoStone's exact scoring contract to the existing
-- PostgreSQL-backed local/Modal KataGo worker. No profile or job is seeded.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS katago_scoring_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_identity TEXT NOT NULL UNIQUE
    CHECK (request_identity ~ '^sha256:[0-9a-f]{64}$'),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
  scoring_revision INT NOT NULL CHECK (scoring_revision > 0),
  analysis_purpose TEXT NOT NULL
    CHECK (analysis_purpose IN ('initial-suggestion','deadline-adjudication')),
  request JSONB NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed')),
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
  CONSTRAINT katago_scoring_jobs_request_shape_check CHECK (
    request->>'requestIdentity' = request_identity
    AND request->>'gameId' = game_id::text
    AND (request->>'scoringRevision')::INT = scoring_revision
    AND request->>'analysisPurpose' = analysis_purpose
  ),
  CONSTRAINT katago_scoring_jobs_result_shape_check CHECK (
    (status='completed' AND result IS NOT NULL AND completed_at IS NOT NULL
      AND error_code IS NULL AND error_message IS NULL)
    OR (status<>'completed' AND result IS NULL AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_katago_scoring_jobs_claim
  ON katago_scoring_jobs(status,created_at,id)
  WHERE status IN ('queued','running');

CREATE OR REPLACE FUNCTION public.validate_katago_scoring_job_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD; scoring_row RECORD;
BEGIN
  SELECT * INTO game_row FROM public.games WHERE id=NEW.game_id FOR UPDATE;
  SELECT * INTO scoring_row FROM public.game_japanese_scoring_state
   WHERE game_id=NEW.game_id FOR UPDATE;
  IF game_row.id IS NULL OR scoring_row.game_id IS NULL
    OR game_row.status<>'active' OR game_row.phase<>'scoring'
    OR game_row.rules<>'japanese'
    OR game_row.rules_profile<>'japanese-1989-gostone-v1'
    OR game_row.scoring_method<>'territory' OR game_row.komi<>6.5
    OR game_row.handicap<>0 OR scoring_row.revision<>NEW.scoring_revision
    OR NEW.request->>'stoppedBoardHash' IS DISTINCT FROM scoring_row.board_hash
    OR (NEW.request->>'stoppedMoveNumber')::INT IS DISTINCT FROM scoring_row.stopped_move_number
    OR NEW.request->'rules'->>'ruleset' IS DISTINCT FROM game_row.rules
    OR NEW.request->'rules'->>'rulesProfile' IS DISTINCT FROM game_row.rules_profile
    OR NEW.request->'rules'->>'scoringMethod' IS DISTINCT FROM game_row.scoring_method
    OR (NEW.request->'rules'->>'komi')::NUMERIC IS DISTINCT FROM game_row.komi
    OR (NEW.request->'rules'->>'handicap')::INT IS DISTINCT FROM game_row.handicap
    OR (NEW.analysis_purpose='initial-suggestion' AND scoring_row.suggestion_status<>'pending')
    OR (NEW.analysis_purpose='deadline-adjudication' AND scoring_row.expires_at>statement_timestamp())
  THEN
    RAISE EXCEPTION 'KataGo scoring job does not match the current stopped Japanese position.'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_katago_scoring_job_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'KataGo scoring jobs are retained as immutable request evidence.'
      USING ERRCODE='23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.request_identity IS DISTINCT FROM OLD.request_identity
    OR NEW.game_id IS DISTINCT FROM OLD.game_id
    OR NEW.scoring_revision IS DISTINCT FROM OLD.scoring_revision
    OR NEW.analysis_purpose IS DISTINCT FROM OLD.analysis_purpose
    OR NEW.request IS DISTINCT FROM OLD.request
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.status='completed'
  THEN
    RAISE EXCEPTION 'KataGo scoring request identity is immutable.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.validate_katago_scoring_job_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_katago_scoring_job_mutation() FROM PUBLIC;

CREATE TRIGGER katago_scoring_job_insert_guard BEFORE INSERT ON katago_scoring_jobs
  FOR EACH ROW EXECUTE FUNCTION public.validate_katago_scoring_job_insert();
CREATE TRIGGER katago_scoring_job_update_guard BEFORE UPDATE ON katago_scoring_jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_katago_scoring_job_mutation();
CREATE TRIGGER katago_scoring_job_delete_guard BEFORE DELETE ON katago_scoring_jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_katago_scoring_job_mutation();
CREATE TRIGGER katago_scoring_job_truncate_guard BEFORE TRUNCATE ON katago_scoring_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_katago_scoring_job_mutation();

ALTER TABLE katago_scoring_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katago_scoring_jobs FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gostone_app') THEN
    GRANT SELECT,INSERT,UPDATE ON katago_scoring_jobs TO gostone_app;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='katago_scoring_jobs' AND policyname='gostone_app_server_access') THEN
      CREATE POLICY gostone_app_server_access ON katago_scoring_jobs
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON katago_scoring_jobs FROM anon;
    REVOKE ALL ON FUNCTION public.validate_katago_scoring_job_insert(),
      public.guard_katago_scoring_job_mutation() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON katago_scoring_jobs FROM authenticated;
    REVOKE ALL ON FUNCTION public.validate_katago_scoring_job_insert(),
      public.guard_katago_scoring_job_mutation() FROM authenticated;
  END IF;
END $$;
