-- Exchange a short-lived, one-use native OAuth code for a server-side session.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE mobile_oauth_handoffs (
  code_hash TEXT PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  code_challenge TEXT NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_subject TEXT NOT NULL CHECK (CHAR_LENGTH(provider_subject) BETWEEN 1 AND 255),
  email TEXT CHECK (email IS NULL OR CHAR_LENGTH(email) <= 320),
  email_verified BOOLEAN NOT NULL DEFAULT false,
  display_name TEXT CHECK (display_name IS NULL OR CHAR_LENGTH(display_name) <= 255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX idx_mobile_oauth_handoffs_expires
  ON mobile_oauth_handoffs(expires_at);

ALTER TABLE mobile_oauth_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mobile_oauth_handoffs FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON mobile_oauth_handoffs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON mobile_oauth_handoffs FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, DELETE ON mobile_oauth_handoffs TO gostone_app;
    CREATE POLICY gostone_app_mobile_oauth_access ON mobile_oauth_handoffs
      FOR ALL TO gostone_app USING (true) WITH CHECK (true);
  END IF;
END
$$;
