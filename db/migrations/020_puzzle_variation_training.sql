ALTER TABLE puzzles
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS rank_kyu INT,
  ADD COLUMN IF NOT EXISTS collection_order INT,
  ADD COLUMN IF NOT EXISTS variation JSONB;

ALTER TABLE puzzles
  DROP CONSTRAINT IF EXISTS puzzles_category_shape_check;
ALTER TABLE puzzles
  ADD CONSTRAINT puzzles_category_shape_check CHECK (
    (category IS NULL AND rank_kyu IS NULL AND collection_order IS NULL AND variation IS NULL)
    OR (
      kind = 'practice'
      AND category IN ('life_and_death', 'tesuji', 'capturing_race', 'endgame')
      AND rank_kyu BETWEEN 1 AND 30
      AND collection_order BETWEEN 1 AND 10
      AND jsonb_typeof(variation) = 'object'
      AND variation ? 'version'
      AND variation ? 'mainLine'
      AND variation ? 'refutations'
    )
  );

ALTER TABLE puzzle_generation_jobs
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS rank_kyu INT,
  ADD COLUMN IF NOT EXISTS collection_order INT;

ALTER TABLE puzzle_generation_jobs
  DROP CONSTRAINT IF EXISTS puzzle_generation_jobs_category_shape_check;
ALTER TABLE puzzle_generation_jobs
  ADD CONSTRAINT puzzle_generation_jobs_category_shape_check CHECK (
    (category IS NULL AND rank_kyu IS NULL AND collection_order IS NULL)
    OR (
      kind = 'practice'
      AND target_date IS NULL
      AND category IN ('life_and_death', 'tesuji', 'capturing_race', 'endgame')
      AND rank_kyu BETWEEN 1 AND 30
      AND collection_order BETWEEN 1 AND 10
    )
  );

ALTER TABLE puzzle_attempts
  ADD COLUMN IF NOT EXISTS variation_progress JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS variation_revision INT NOT NULL DEFAULT 0;

ALTER TABLE puzzle_attempts
  DROP CONSTRAINT IF EXISTS puzzle_attempts_variation_progress_check;
ALTER TABLE puzzle_attempts
  ADD CONSTRAINT puzzle_attempts_variation_progress_check CHECK (
    jsonb_typeof(variation_progress) = 'array'
    AND jsonb_array_length(variation_progress) <= 12
    AND variation_revision BETWEEN 0 AND 1000
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_puzzles_category_order
  ON puzzles(category, collection_order)
  WHERE kind = 'practice' AND category IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_puzzle_jobs_category_order
  ON puzzle_generation_jobs(category, collection_order)
  WHERE kind = 'practice' AND category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_puzzles_category_catalog
  ON puzzles(category, collection_order, id)
  WHERE kind = 'practice' AND category IS NOT NULL;
