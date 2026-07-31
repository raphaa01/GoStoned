-- Close the deployment race in which an older worker can recreate a 9x9
-- template job between the catalog reset and the new worker rollout.
DELETE FROM puzzle_attempts
 WHERE puzzle_id IN (
   SELECT id FROM puzzles WHERE kind = 'practice' AND category IS NOT NULL
 );

DELETE FROM puzzle_generation_jobs
 WHERE kind = 'practice' AND category IS NOT NULL;

DELETE FROM puzzles
 WHERE kind = 'practice' AND category IS NOT NULL;

ALTER TABLE puzzles
  DROP CONSTRAINT IF EXISTS puzzles_category_shape_check;
ALTER TABLE puzzles
  ADD CONSTRAINT puzzles_category_shape_check CHECK (
    (category IS NULL AND rank_kyu IS NULL AND collection_order IS NULL AND variation IS NULL)
    OR (
      kind = 'practice'
      AND board_size = 13
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
  DROP CONSTRAINT IF EXISTS puzzle_generation_jobs_category_shape_check;
ALTER TABLE puzzle_generation_jobs
  ADD CONSTRAINT puzzle_generation_jobs_category_shape_check CHECK (
    (category IS NULL AND rank_kyu IS NULL AND collection_order IS NULL)
    OR (
      kind = 'practice'
      AND target_date IS NULL
      AND board_size = 13
      AND category IN ('life_and_death', 'tesuji', 'capturing_race', 'endgame')
      AND rank_kyu BETWEEN 1 AND 30
      AND collection_order BETWEEN 1 AND 10
    )
  );
