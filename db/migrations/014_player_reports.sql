CREATE TABLE IF NOT EXISTS player_reports (
  game_id UUID NOT NULL,
  reporter_key TEXT NOT NULL,
  reported_key TEXT NOT NULL,
  category_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_reports_pkey PRIMARY KEY (game_id, reporter_key),
  CONSTRAINT player_reports_game_fk FOREIGN KEY (game_id)
    REFERENCES games(id) ON DELETE RESTRICT,
  CONSTRAINT player_reports_distinct_players_check CHECK (reporter_key <> reported_key),
  CONSTRAINT player_reports_key_bounds_check CHECK (
    reporter_key ~ '^(user|guest):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND reported_key ~ '^(user|guest):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT player_reports_category_check CHECK (
    category_code IN (
      'abuse_or_hate',
      'threat_or_sexual_safety',
      'fair_play',
      'stalling_or_abandonment',
      'spam_scam_or_identity',
      'other'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_player_reports_reported_created
  ON player_reports(reported_key, created_at DESC, game_id, reporter_key);

ALTER TABLE player_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON player_reports FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON player_reports FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON player_reports FROM authenticated;
  END IF;
END
$$;
