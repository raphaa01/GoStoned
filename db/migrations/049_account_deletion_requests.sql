SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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
