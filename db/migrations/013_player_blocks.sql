CREATE TABLE IF NOT EXISTS player_blocks (
  blocker_key TEXT NOT NULL,
  blocked_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_blocks_pkey PRIMARY KEY (blocker_key, blocked_key),
  CONSTRAINT player_blocks_distinct_players_check CHECK (blocker_key <> blocked_key),
  CONSTRAINT player_blocks_key_bounds_check CHECK (
    blocker_key ~ '^(user|guest):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND blocked_key ~ '^(user|guest):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_player_blocks_blocked_blocker
  ON player_blocks(blocked_key, blocker_key);

CREATE INDEX IF NOT EXISTS idx_player_blocks_guest_retention
  ON player_blocks(created_at, blocker_key, blocked_key)
  WHERE blocker_key LIKE 'guest:%' OR blocked_key LIKE 'guest:%';

ALTER TABLE player_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON player_blocks FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON player_blocks FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON player_blocks FROM authenticated;
  END IF;
END
$$;
