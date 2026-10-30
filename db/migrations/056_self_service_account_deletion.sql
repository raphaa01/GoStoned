SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Repair installations whose migration ledger advanced without the disabled
-- request table. This is safe when migration 049 was already applied correctly.
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_key TEXT CHECK (player_key ~ '^(user|guest):[0-9a-f-]{36}$'),
  confirmation_email TEXT CHECK (confirmation_email IS NULL OR CHAR_LENGTH(confirmation_email) <= 320),
  receipt_hash TEXT NOT NULL UNIQUE CHECK (receipt_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CHECK (due_at > requested_at),
  CHECK (
    (status <> 'completed' AND player_key IS NOT NULL AND completed_at IS NULL)
    OR (status = 'completed' AND player_key IS NULL AND confirmation_email IS NULL
        AND completed_at IS NOT NULL AND completed_at >= requested_at)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_deletion_requests_open_player
  ON account_deletion_requests (player_key) WHERE status <> 'completed';
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_due
  ON account_deletion_requests (due_at) WHERE status <> 'completed';

ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_deletion_requests FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON account_deletion_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON account_deletion_requests FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE ON account_deletion_requests TO gostone_app;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public'
        AND tablename = 'account_deletion_requests'
        AND policyname = 'gostone_app_account_deletion_requests_access'
    ) THEN
      CREATE POLICY gostone_app_account_deletion_requests_access ON account_deletion_requests
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END
$$;

-- Claims already permit deletion only after the owning user has been removed.
-- Use that existing cascade exception without weakening the immutable guards.
ALTER TABLE player_initial_rating_claims
  DROP CONSTRAINT IF EXISTS player_initial_rating_claims_user_id_fkey,
  ADD CONSTRAINT player_initial_rating_claims_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Historical rating evidence outlives the account and its current rating state.
-- Insert/commit triggers still require and validate both live rating states.
-- UPDATE, DELETE and TRUNCATE guards on the evidence remain in force.
ALTER TABLE game_glicko2_rating_events
  DROP CONSTRAINT IF EXISTS game_glicko2_rating_events_player_fk;

-- Keep Apple revocation credentials encrypted, including before registration
-- finishes. They never travel through browser/native handoffs or API responses.
CREATE TABLE IF NOT EXISTS apple_revocation_tokens (
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
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'apple_revocation_tokens' AND policyname = 'gostone_app_apple_revocation_tokens_access') THEN
      CREATE POLICY gostone_app_apple_revocation_tokens_access ON apple_revocation_tokens
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
    GRANT DELETE ON account_deletion_requests TO gostone_app;
  END IF;
END
$$;
