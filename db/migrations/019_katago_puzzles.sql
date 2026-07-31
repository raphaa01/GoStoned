CREATE TABLE IF NOT EXISTS puzzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'practice')),
  daily_date DATE,
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  to_play TEXT NOT NULL CHECK (to_play IN ('black', 'white')),
  position_moves JSONB NOT NULL CHECK (jsonb_typeof(position_moves) = 'array'),
  board JSONB NOT NULL CHECK (jsonb_typeof(board) = 'array'),
  solution_move TEXT NOT NULL CHECK (char_length(solution_move) BETWEEN 2 AND 4),
  solution_x INT NOT NULL,
  solution_y INT NOT NULL,
  alternatives JSONB NOT NULL CHECK (jsonb_typeof(alternatives) = 'array'),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  explanation JSONB NOT NULL CHECK (
    jsonb_typeof(explanation) = 'object'
    AND explanation ? 'en'
    AND explanation ? 'de'
  ),
  engine_version TEXT NOT NULL,
  model_name TEXT NOT NULL,
  visits INT NOT NULL CHECK (visits BETWEEN 1 AND 10000),
  source_game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  source_move_number INT CHECK (source_move_number IS NULL OR source_move_number >= 0),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT puzzles_daily_shape_check CHECK (
    (kind = 'daily' AND daily_date IS NOT NULL)
    OR (kind = 'practice' AND daily_date IS NULL)
  ),
  CONSTRAINT puzzles_solution_bounds_check CHECK (
    solution_x >= 0 AND solution_x < board_size
    AND solution_y >= 0 AND solution_y < board_size
  )
);

CREATE TABLE IF NOT EXISTS puzzle_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'practice')),
  target_date DATE,
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  puzzle_id UUID REFERENCES puzzles(id) ON DELETE SET NULL,
  worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT puzzle_generation_jobs_target_shape_check CHECK (
    (kind = 'daily' AND target_date IS NOT NULL)
    OR (kind = 'practice' AND target_date IS NULL)
  ),
  CONSTRAINT puzzle_generation_jobs_result_shape_check CHECK (
    (status = 'completed' AND puzzle_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND puzzle_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS puzzle_attempts (
  puzzle_id UUID NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL CHECK (
    char_length(player_key) BETWEEN 6 AND 128
    AND (player_key LIKE 'guest:%' OR player_key LIKE 'user:%')
  ),
  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 1000),
  solved BOOLEAN NOT NULL DEFAULT false,
  first_attempt_correct BOOLEAN,
  selected_x INT,
  selected_y INT,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  solved_at TIMESTAMPTZ,
  PRIMARY KEY (puzzle_id, player_key),
  CONSTRAINT puzzle_attempts_selection_shape_check CHECK (
    (attempt_count = 0 AND selected_x IS NULL AND selected_y IS NULL)
    OR (attempt_count > 0 AND selected_x IS NOT NULL AND selected_y IS NOT NULL)
  ),
  CONSTRAINT puzzle_attempts_solved_shape_check CHECK (
    (solved AND solved_at IS NOT NULL)
    OR (NOT solved AND solved_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_puzzles_daily_date
  ON puzzles(daily_date)
  WHERE kind = 'daily';
CREATE INDEX IF NOT EXISTS idx_puzzles_practice_published
  ON puzzles(published_at DESC, id)
  WHERE kind = 'practice';
CREATE UNIQUE INDEX IF NOT EXISTS idx_puzzle_jobs_daily_target
  ON puzzle_generation_jobs(target_date)
  WHERE kind = 'daily';
CREATE INDEX IF NOT EXISTS idx_puzzle_generation_jobs_claim
  ON puzzle_generation_jobs(status, created_at, id)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_puzzle_attempts_player
  ON puzzle_attempts(player_key, last_attempt_at DESC);

ALTER TABLE puzzles ENABLE ROW LEVEL SECURITY;
ALTER TABLE puzzle_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE puzzle_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON puzzles, puzzle_generation_jobs, puzzle_attempts FROM PUBLIC;

DO $gostone_puzzle_access$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON puzzles, puzzle_generation_jobs, puzzle_attempts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON puzzles, puzzle_generation_jobs, puzzle_attempts FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON puzzles, puzzle_generation_jobs, puzzle_attempts TO gostone_app;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'puzzles'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON puzzles
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'puzzle_generation_jobs'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON puzzle_generation_jobs
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'puzzle_attempts'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON puzzle_attempts
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END
$gostone_puzzle_access$;
