SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Claims already permit deletion only after the owning user has been removed.
-- Use that existing cascade exception without weakening the immutable guards.
ALTER TABLE player_initial_rating_claims
  DROP CONSTRAINT player_initial_rating_claims_user_id_fkey,
  ADD CONSTRAINT player_initial_rating_claims_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Historical rating evidence outlives the account and its current rating state.
-- Insert/commit triggers still require and validate both live rating states.
-- UPDATE, DELETE and TRUNCATE guards on the evidence remain in force.
ALTER TABLE game_glicko2_rating_events
  DROP CONSTRAINT game_glicko2_rating_events_player_fk;

-- Keep Apple revocation credentials encrypted, including before registration
-- finishes. They never travel through browser/native handoffs or API responses.
CREATE TABLE apple_revocation_tokens (
  provider_subject TEXT PRIMARY KEY CHECK (CHAR_LENGTH(provider_subject) BETWEEN 1 AND 255),
  encrypted_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE apple_revocation_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON apple_revocation_tokens FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON apple_revocation_tokens FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON apple_revocation_tokens FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON apple_revocation_tokens TO gostone_app;
    CREATE POLICY gostone_app_apple_revocation_tokens_access ON apple_revocation_tokens
      FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    GRANT DELETE ON account_deletion_requests TO gostone_app;
  END IF;
END
$$;
