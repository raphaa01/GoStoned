ALTER TABLE tournaments ADD COLUMN rapid_rankings_finalized BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE tournament_rapid_rankings (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place INT NOT NULL CHECK (place > 0),
  score NUMERIC(8, 2) NOT NULL,
  wins INT NOT NULL CHECK (wins BETWEEN 0 AND 10),
  displayed BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (tournament_id, user_id)
);
CREATE INDEX tournament_rapid_rankings_user_idx ON tournament_rapid_rankings(user_id);
ALTER TABLE tournament_rapid_rankings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tournament_rapid_rankings FROM PUBLIC;

DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON tournament_rapid_rankings FROM %I',role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gostone_app') THEN
    REVOKE ALL ON tournament_rapid_rankings FROM gostone_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON tournament_rapid_rankings TO gostone_app;
    CREATE POLICY gostone_app_server_access ON tournament_rapid_rankings
      TO gostone_app USING (true) WITH CHECK (true);
  END IF;
END $$;
