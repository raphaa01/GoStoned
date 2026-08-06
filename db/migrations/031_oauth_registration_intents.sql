-- Keep verified provider identities server-side while a new player chooses a
-- public GoStone username. Raw browser tokens are never stored.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE auth_identities
  ADD COLUMN username_confirmed BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE oauth_registration_intents (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_subject TEXT NOT NULL CHECK (CHAR_LENGTH(provider_subject) BETWEEN 1 AND 255),
  email TEXT CHECK (email IS NULL OR CHAR_LENGTH(email) <= 320),
  email_verified BOOLEAN NOT NULL DEFAULT false,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id),
  CHECK (expires_at > created_at)
);

CREATE INDEX idx_oauth_registration_intents_expires
  ON oauth_registration_intents(expires_at);

ALTER TABLE oauth_registration_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oauth_registration_intents FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON oauth_registration_intents FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON oauth_registration_intents FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_registration_intents TO gostone_app;
    CREATE POLICY gostone_app_oauth_registration_access ON oauth_registration_intents
      FOR ALL TO gostone_app USING (true) WITH CHECK (true);
  END IF;
END
$$;
