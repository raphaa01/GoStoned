CREATE TABLE tournament_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  premium_hosting_enabled BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO tournament_settings (id) VALUES (true);

CREATE TABLE tournament_host_entitlements (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  premium_until TIMESTAMPTZ NOT NULL
);

CREATE TABLE tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('private','monthly')),
  host_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  code TEXT UNIQUE CHECK (code ~ '^[A-Z0-9]{10}$'),
  month TEXT CHECK (month ~ '^\d{4}-\d{2}$'),
  category INT CHECK (category BETWEEN 0 AND 3),
  format TEXT NOT NULL CHECK (format IN ('round_robin','knockout','league')),
  board_size INT NOT NULL CHECK (board_size IN (9,13,19)),
  time_control TEXT NOT NULL CHECK (time_control IN ('blitz','rapid','classic')),
  max_players INT NOT NULL CHECK (max_players BETWEEN 2 AND 32),
  status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby','running','finished','cancelled')),
  round INT NOT NULL DEFAULT 0 CHECK (round >= 0),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CHECK ((kind='private' AND code IS NOT NULL AND month IS NULL AND category IS NULL
          AND format IN ('round_robin','knockout')) OR
         (kind='monthly' AND code IS NULL AND month IS NOT NULL AND category IS NOT NULL
          AND format='league' AND ends_at > starts_at AND host_id IS NULL)),
  UNIQUE (month,category)
);
CREATE INDEX tournaments_host_idx ON tournaments(host_id) WHERE host_id IS NOT NULL;
CREATE INDEX tournaments_monthly_active_idx ON tournaments(ends_at) WHERE kind='monthly' AND status NOT IN ('finished','cancelled');

CREATE TABLE tournament_members (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating_snapshot NUMERIC NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  queue_until TIMESTAMPTZ,
  PRIMARY KEY(tournament_id,user_id)
);
CREATE INDEX tournament_members_user_idx ON tournament_members(user_id,tournament_id);
CREATE INDEX tournament_members_queue_idx ON tournament_members(tournament_id,queue_until) WHERE queue_until IS NOT NULL;

CREATE TABLE tournament_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round INT NOT NULL CHECK (round > 0),
  slot INT NOT NULL CHECK (slot >= 0),
  black_id UUID REFERENCES users(id) ON DELETE SET NULL,
  white_id UUID REFERENCES users(id) ON DELETE SET NULL,
  black_ready BOOLEAN NOT NULL DEFAULT false,
  white_ready BOOLEAN NOT NULL DEFAULT false,
  ready_deadline TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','playing','finished','void')),
  game_id UUID UNIQUE REFERENCES games(id) ON DELETE SET NULL,
  winner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  result TEXT,
  finished_at TIMESTAMPTZ,
  CHECK (black_id IS NULL OR white_id IS NULL OR black_id <> white_id),
  CHECK (winner_id IS NULL OR winner_id=black_id OR winner_id=white_id),
  UNIQUE(tournament_id,round,slot)
);
CREATE INDEX tournament_matches_progress_idx ON tournament_matches(tournament_id,status,round);
CREATE INDEX tournament_matches_black_idx ON tournament_matches(black_id,tournament_id);
CREATE INDEX tournament_matches_white_idx ON tournament_matches(white_id,tournament_id);
CREATE INDEX tournament_matches_winner_idx ON tournament_matches(winner_id) WHERE winner_id IS NOT NULL;

CREATE TABLE tournament_invitations (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(tournament_id,user_id)
);
CREATE INDEX tournament_invitations_user_idx ON tournament_invitations(user_id);

CREATE TABLE tournament_trophies (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place INT NOT NULL CHECK (place BETWEEN 1 AND 3),
  displayed BOOLEAN NOT NULL DEFAULT true,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(tournament_id,user_id)
);
CREATE INDEX tournament_trophies_user_idx ON tournament_trophies(user_id,awarded_at DESC);

DO $$
DECLARE table_name TEXT; role_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['tournament_settings','tournament_host_entitlements','tournaments','tournament_members','tournament_matches','tournament_invitations','tournament_trophies'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I',table_name,role_name);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gostone_app') THEN
      EXECUTE format('REVOKE ALL ON %I FROM gostone_app',table_name);
      IF table_name IN ('tournament_settings','tournament_host_entitlements') THEN
        EXECUTE format('GRANT SELECT ON %I TO gostone_app',table_name);
      ELSE
        EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO gostone_app',table_name);
      END IF;
      EXECUTE format('CREATE POLICY gostone_app_server_access ON %I TO gostone_app USING (true) WITH CHECK (true)',table_name);
    END IF;
  END LOOP;
END $$;
