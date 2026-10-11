SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Provider email stays on auth_identities; never link accounts by email.
ALTER TABLE users ADD COLUMN email TEXT
  CHECK (email IS NULL OR (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254));
CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE password_reset_codes (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  delivered BOOLEAN NOT NULL DEFAULT false,
  CHECK (expires_at > created_at)
);
CREATE INDEX idx_password_reset_codes_expires ON password_reset_codes (expires_at);
ALTER TABLE password_reset_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON password_reset_codes FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON password_reset_codes FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON password_reset_codes FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_codes TO gostone_app;
    CREATE POLICY gostone_app_password_reset_access ON password_reset_codes
      FOR ALL TO gostone_app USING (true) WITH CHECK (true);
  END IF;
END
$$;
