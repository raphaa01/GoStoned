-- Map verified OAuth identities to ordinary GoStone users without storing
-- provider access or refresh tokens.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE auth_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_subject TEXT NOT NULL CHECK (CHAR_LENGTH(provider_subject) BETWEEN 1 AND 255),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT CHECK (email IS NULL OR CHAR_LENGTH(email) <= 320),
  email_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (provider, provider_subject),
  UNIQUE (user_id, provider),
  CHECK (updated_at >= created_at AND last_login_at >= created_at)
);

ALTER TABLE auth_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth_identities FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON auth_identities FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON auth_identities FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE ON auth_identities TO gostone_app;
  END IF;
END
$$;
