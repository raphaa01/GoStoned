-- Keep the existing Rapid pools: leaderboard groups do not restrict matchmaking.
ALTER TABLE tournaments ADD COLUMN monthly_mode TEXT NOT NULL DEFAULT 'rapid'
  CHECK (monthly_mode IN ('rapid','classic'));
ALTER TABLE tournaments ADD COLUMN schedule_hour INT NOT NULL DEFAULT -1
  CHECK (schedule_hour IN (-1,8,16,20));
UPDATE tournaments SET name='Monthly Rapid '||month
  WHERE kind='monthly' AND name='Monthly '||month;
-- Keep the old uniqueness target until the old website has been replaced.
ALTER TABLE tournament_settings ADD COLUMN monthly_classic_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tournaments ADD UNIQUE(month,category,monthly_mode,schedule_hour);
ALTER TABLE tournaments ADD CHECK (
  (monthly_mode='rapid' AND schedule_hour=-1) OR
  (kind='monthly' AND monthly_mode='classic' AND category>=2 AND board_size=19
    AND time_control='classic' AND schedule_hour IN (8,16,20)));

ALTER TABLE tournament_members ADD COLUMN leaderboard_group INT NOT NULL DEFAULT 1 CHECK (leaderboard_group>0);
ALTER TABLE tournament_members ADD COLUMN no_shows INT NOT NULL DEFAULT 0 CHECK (no_shows>=0);
ALTER TABLE tournament_members ADD COLUMN withdrawn BOOLEAN NOT NULL DEFAULT false;
-- Freeze an initial group for existing entrants without disturbing their games.
WITH groups AS (
  SELECT tournament_id,user_id,((row_number() OVER
    (PARTITION BY tournament_id ORDER BY joined_at,user_id)-1)/24+1)::int AS group_no
  FROM tournament_members
) UPDATE tournament_members p SET leaderboard_group=g.group_no FROM groups g
WHERE p.tournament_id=g.tournament_id AND p.user_id=g.user_id;
CREATE INDEX tournament_members_group_idx ON tournament_members(tournament_id,leaderboard_group);
ALTER TABLE tournament_matches ADD COLUMN group_no INT NOT NULL DEFAULT 1 CHECK (group_no>0);
ALTER TABLE tournament_matches ADD COLUMN scheduled_at TIMESTAMPTZ;
ALTER TABLE tournament_matches ADD COLUMN attendance_recorded BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tournament_trophies ADD COLUMN group_no INT NOT NULL DEFAULT 1 CHECK (group_no>0);

CREATE TABLE tournament_classic_penalties (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  blocked_month TEXT NOT NULL CHECK (blocked_month ~ '^\d{4}-\d{2}$'),
  PRIMARY KEY(user_id,tournament_id)
);
CREATE INDEX tournament_classic_penalties_month_idx ON tournament_classic_penalties(user_id,blocked_month);
CREATE INDEX tournament_classic_penalties_tournament_idx ON tournament_classic_penalties(tournament_id);
ALTER TABLE tournament_classic_penalties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tournament_classic_penalties FROM PUBLIC;
DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON tournament_classic_penalties FROM %I',role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gostone_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON tournament_classic_penalties TO gostone_app;
    CREATE POLICY gostone_app_server_access ON tournament_classic_penalties
      TO gostone_app USING (true) WITH CHECK (true);
  END IF;
END $$;
