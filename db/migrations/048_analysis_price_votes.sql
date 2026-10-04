SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS analysis_price_votes (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_price_eur SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT analysis_price_votes_price_check
    CHECK (monthly_price_eur IN (3, 5, 8, 12))
);

ALTER TABLE analysis_price_votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON analysis_price_votes FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON analysis_price_votes FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON analysis_price_votes FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE ON analysis_price_votes TO gostone_app;
    IF NOT EXISTS (
      SELECT 1
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'analysis_price_votes'
         AND policyname = 'gostone_app_analysis_price_votes_access'
    ) THEN
      CREATE POLICY gostone_app_analysis_price_votes_access ON analysis_price_votes
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END
$$;
