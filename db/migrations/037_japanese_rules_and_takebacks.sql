-- Activate Japanese territory scoring for new games and persist one pending
-- consent-based takeback request per active game.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_rules_profile_check;
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_scoring_method_check;
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_rules_check;
ALTER TABLE games
  ADD CONSTRAINT games_rules_profile_check CHECK (
    rules_profile IN ('legacy-immediate-area', 'chinese-2002-gostone-v1', 'japanese-1989-gostone-v1')
  ),
  ADD CONSTRAINT games_scoring_method_check CHECK (scoring_method IN ('area', 'territory')),
  ADD CONSTRAINT games_rules_check CHECK (rules IN ('chinese', 'japanese'));
ALTER TABLE games
  ALTER COLUMN komi SET DEFAULT 6.5,
  ALTER COLUMN rules SET DEFAULT 'japanese',
  ALTER COLUMN rules_profile SET DEFAULT 'japanese-1989-gostone-v1',
  ALTER COLUMN scoring_method SET DEFAULT 'territory';

ALTER TABLE matchmaking_queue
  DROP CONSTRAINT IF EXISTS matchmaking_queue_rules_profile_compatibility_check;
ALTER TABLE matchmaking_queue
  ADD CONSTRAINT matchmaking_queue_rules_profile_compatibility_check CHECK (
    rules_profile IN ('legacy-immediate-area', 'chinese-2002-gostone-v1', 'japanese-1989-gostone-v1')
  );
ALTER TABLE matchmaking_queue
  ALTER COLUMN rules_profile SET DEFAULT 'japanese-1989-gostone-v1';

ALTER TABLE game_scoring_state DROP CONSTRAINT IF EXISTS game_scoring_state_rules_check;
ALTER TABLE game_scoring_state DROP CONSTRAINT IF EXISTS game_scoring_state_rules_profile_check;
ALTER TABLE game_scoring_state DROP CONSTRAINT IF EXISTS game_scoring_state_scoring_method_check;
ALTER TABLE game_scoring_state ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE game_scoring_state
  ADD CONSTRAINT game_scoring_state_rules_check CHECK (rules IN ('chinese', 'japanese')),
  ADD CONSTRAINT game_scoring_state_rules_profile_check CHECK (
    rules_profile IN ('chinese-2002-gostone-v1', 'japanese-1989-gostone-v1')
  ),
  ADD CONSTRAINT game_scoring_state_scoring_method_check CHECK (scoring_method IN ('area', 'territory'));

ALTER TABLE game_scoring_resume_events DROP CONSTRAINT IF EXISTS game_scoring_resume_events_rules_check;
ALTER TABLE game_scoring_resume_events DROP CONSTRAINT IF EXISTS game_scoring_resume_events_rules_profile_check;
ALTER TABLE game_scoring_resume_events DROP CONSTRAINT IF EXISTS game_scoring_resume_events_scoring_method_check;
ALTER TABLE game_scoring_resume_events DROP CONSTRAINT IF EXISTS game_scoring_resume_events_komi_check;
ALTER TABLE game_scoring_resume_events DROP CONSTRAINT IF EXISTS game_scoring_resume_events_claim_shape_check;
ALTER TABLE game_scoring_resume_events ALTER COLUMN scoring_expires_at DROP NOT NULL;
ALTER TABLE game_scoring_resume_events
  ADD CONSTRAINT game_scoring_resume_events_rules_check CHECK (rules IN ('chinese', 'japanese')),
  ADD CONSTRAINT game_scoring_resume_events_rules_profile_check CHECK (
    rules_profile IN ('chinese-2002-gostone-v1', 'japanese-1989-gostone-v1')
  ),
  ADD CONSTRAINT game_scoring_resume_events_scoring_method_check CHECK (scoring_method IN ('area', 'territory')),
  ADD CONSTRAINT game_scoring_resume_events_komi_check CHECK (komi IN (6.5, 7.5)),
  ADD CONSTRAINT game_scoring_resume_events_claim_shape_check CHECK (
    (
      resume_claim IN ('dead', 'alive')
      AND requested_by_color IS NOT NULL
      AND disputed_x IS NOT NULL AND disputed_y IS NOT NULL
      AND (
        (rules = 'chinese' AND (
          scoring_expires_at IS NOT NULL
          AND resumed_at < scoring_expires_at
          AND ((resume_claim = 'dead' AND resumed_to_move = requested_by_color)
            OR (resume_claim = 'alive' AND resumed_to_move <> requested_by_color))
        ))
        OR (rules = 'japanese' AND scoring_expires_at IS NULL
          AND resumed_to_move <> requested_by_color)
      )
    )
    OR (
      resume_claim = 'deadline'
      AND requested_by_color IS NULL
      AND disputed_x IS NULL AND disputed_y IS NULL
      AND resumed_to_move = fallback_to_move
      AND scoring_expires_at IS NOT NULL
      AND scoring_expires_at <= resumed_at
    )
  );

CREATE TABLE game_takeback_requests (
  game_id UUID PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  move_number INT NOT NULL CHECK (move_number > 0),
  requested_by_color TEXT NOT NULL CHECK (requested_by_color IN ('black', 'white')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE game_takeback_requests ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON game_takeback_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON game_takeback_requests FROM authenticated;
  END IF;
END
$$;
