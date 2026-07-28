ALTER TABLE games
  ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'play',
  ADD COLUMN IF NOT EXISTS to_move TEXT,
  ADD COLUMN IF NOT EXISTS consecutive_passes INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scoring_revision INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rules_profile TEXT,
  ADD COLUMN IF NOT EXISTS scoring_method TEXT NOT NULL DEFAULT 'area',
  ADD COLUMN IF NOT EXISTS handicap INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finish_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_resume_claim TEXT,
  ADD COLUMN IF NOT EXISTS last_resume_by TEXT,
  ADD COLUMN IF NOT EXISTS last_resume_x INT,
  ADD COLUMN IF NOT EXISTS last_resume_y INT;

ALTER TABLE games ALTER COLUMN komi SET DEFAULT 7.5;

UPDATE games
   SET rules_profile = 'legacy-immediate-area'
 WHERE rules_profile IS NULL;

ALTER TABLE games
  -- Keep the old default while previous application instances can still
  -- create games. The new application opts agreement games in explicitly.
  ALTER COLUMN rules_profile SET DEFAULT 'legacy-immediate-area',
  ALTER COLUMN rules_profile SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM games WHERE rules <> 'chinese') THEN
    RAISE EXCEPTION 'Migration 008 only supports existing Chinese-rules games';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM games
     WHERE status = 'finished'
       AND (result IS NULL OR finished_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'Migration 008 found an incomplete historical finished game';
  END IF;
END
$$;

UPDATE games g
   SET to_move = CASE
     WHEN (
       SELECT COUNT(*)
         FROM moves m
        WHERE m.game_id = g.id
     ) % 2 = 0 THEN 'black'
     ELSE 'white'
   END
 WHERE g.status = 'active'
   AND g.to_move IS NULL;

ALTER TABLE games ALTER COLUMN to_move SET DEFAULT 'black';

UPDATE games
   SET to_move = NULL,
       finish_reason = CASE
         WHEN result LIKE '%+R' THEN 'resignation'
         WHEN result LIKE '%+T' THEN 'timeout'
         ELSE 'legacy_score'
       END
 WHERE status = 'finished';

UPDATE games g
   SET consecutive_passes = CASE
     WHEN EXISTS (
       SELECT 1
         FROM moves m
        WHERE m.game_id = g.id
          AND m.move_number = (
            SELECT MAX(last_move.move_number)
              FROM moves last_move
             WHERE last_move.game_id = g.id
          )
          AND m.is_pass
     ) THEN 1
     ELSE 0
   END
 WHERE g.status = 'active';

CREATE TABLE IF NOT EXISTS game_scoring_state (
  game_id UUID PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  board_hash TEXT NOT NULL,
  stopped_move_number INT NOT NULL CHECK (stopped_move_number >= 2),
  revision INT NOT NULL CHECK (revision > 0),
  rules TEXT NOT NULL CHECK (rules = 'chinese'),
  rules_profile TEXT NOT NULL CHECK (rules_profile = 'chinese-2002-gostone-v1'),
  scoring_method TEXT NOT NULL CHECK (scoring_method = 'area'),
  komi NUMERIC(4,1) NOT NULL,
  handicap INT NOT NULL CHECK (handicap = 0),
  fallback_to_move TEXT NOT NULL CHECK (fallback_to_move IN ('black', 'white')),
  expires_at TIMESTAMPTZ NOT NULL,
  black_confirmed_revision INT,
  white_confirmed_revision INT,
  black_confirmed_at TIMESTAMPTZ,
  white_confirmed_at TIMESTAMPTZ,
  scored_board_hash TEXT,
  black_stones INT,
  white_stones INT,
  black_territory INT,
  white_territory INT,
  neutral_points INT,
  black_dead_stones INT,
  white_dead_stones INT,
  black_total NUMERIC(6,1),
  white_total NUMERIC(6,1),
  result TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ,
  CHECK (black_stones IS NULL OR black_stones >= 0),
  CHECK (white_stones IS NULL OR white_stones >= 0),
  CHECK (black_territory IS NULL OR black_territory >= 0),
  CHECK (white_territory IS NULL OR white_territory >= 0),
  CHECK (neutral_points IS NULL OR neutral_points >= 0),
  CHECK (black_dead_stones IS NULL OR black_dead_stones >= 0),
  CHECK (white_dead_stones IS NULL OR white_dead_stones >= 0),
  CHECK (black_confirmed_revision IS NULL OR black_confirmed_revision = revision),
  CHECK (white_confirmed_revision IS NULL OR white_confirmed_revision = revision),
  CHECK ((black_confirmed_revision IS NULL) = (black_confirmed_at IS NULL)),
  CHECK ((white_confirmed_revision IS NULL) = (white_confirmed_at IS NULL)),
  CHECK (expires_at > started_at),
  CHECK (
    finalized_at IS NULL
    OR (
      black_confirmed_revision IS NOT NULL
      AND white_confirmed_revision IS NOT NULL
      AND black_confirmed_revision = revision
      AND white_confirmed_revision = revision
    )
  ),
  CHECK (
    (
      scored_board_hash IS NULL AND black_stones IS NULL AND white_stones IS NULL
      AND black_territory IS NULL AND white_territory IS NULL AND neutral_points IS NULL
      AND black_dead_stones IS NULL AND white_dead_stones IS NULL
      AND black_total IS NULL AND white_total IS NULL AND result IS NULL
      AND finalized_at IS NULL
    )
    OR
    (
      scored_board_hash IS NOT NULL AND black_stones IS NOT NULL AND white_stones IS NOT NULL
      AND black_territory IS NOT NULL AND white_territory IS NOT NULL
      AND neutral_points IS NOT NULL AND black_dead_stones IS NOT NULL
      AND white_dead_stones IS NOT NULL AND black_total IS NOT NULL
      AND white_total IS NOT NULL AND result IS NOT NULL AND finalized_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS game_dead_stones (
  game_id UUID NOT NULL REFERENCES game_scoring_state(game_id) ON DELETE CASCADE,
  x INT NOT NULL CHECK (x BETWEEN 0 AND 18),
  y INT NOT NULL CHECK (y BETWEEN 0 AND 18),
  color TEXT NOT NULL CHECK (color IN ('black', 'white')),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, x, y)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_last_resume_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_last_resume_check CHECK (
        (
          last_resume_claim IS NULL AND last_resume_by IS NULL
          AND last_resume_x IS NULL AND last_resume_y IS NULL
        )
        OR
        (
          last_resume_claim IS NOT NULL AND last_resume_claim IN ('dead', 'alive')
          AND last_resume_by IS NOT NULL AND last_resume_by IN ('black', 'white')
          AND last_resume_x IS NOT NULL AND last_resume_x BETWEEN 0 AND 18
          AND last_resume_y IS NOT NULL AND last_resume_y BETWEEN 0 AND 18
        )
        OR
        (
          last_resume_claim IS NOT NULL AND last_resume_claim = 'deadline'
          AND last_resume_by IS NULL
          AND last_resume_x IS NULL AND last_resume_y IS NULL
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_rules_profile_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_rules_profile_check
      CHECK (rules_profile IN ('legacy-immediate-area', 'chinese-2002-gostone-v1'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_phase_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_phase_check CHECK (phase IN ('play', 'scoring'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_to_move_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_to_move_check CHECK (to_move IN ('black', 'white'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_consecutive_passes_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_consecutive_passes_check CHECK (consecutive_passes BETWEEN 0 AND 2);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_scoring_revision_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_scoring_revision_check CHECK (scoring_revision >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_scoring_method_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_scoring_method_check CHECK (scoring_method = 'area');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_handicap_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_handicap_check CHECK (handicap = 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_rules_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_rules_check CHECK (rules = 'chinese');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_finish_reason_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_finish_reason_check
      CHECK (finish_reason IN ('score', 'resignation', 'timeout', 'legacy_score'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_game_dead_stones_game_id
  ON game_dead_stones(game_id);

ALTER TABLE game_scoring_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_dead_stones ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON game_scoring_state, game_dead_stones FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON game_scoring_state, game_dead_stones FROM authenticated;
  END IF;
END
$$;
