-- Replace random whole-game daily positions with the deterministic 20-problem cycle.
-- Earlier daily history remains available; only dates owned by this cycle are rebuilt.
DELETE FROM puzzle_attempts
 WHERE puzzle_id IN (
   SELECT id
     FROM puzzles
    WHERE kind = 'daily'
      AND daily_date >= DATE '2026-09-08'
 );

DELETE FROM puzzle_generation_jobs
 WHERE kind = 'daily'
   AND target_date >= DATE '2026-09-08';

DELETE FROM puzzles
 WHERE kind = 'daily'
   AND daily_date >= DATE '2026-09-08';

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
    OR (
      kind = 'daily'
      AND board_size = 13
      AND daily_date IS NOT NULL
      AND category IN ('life_and_death', 'tesuji', 'capturing_race', 'endgame')
      AND rank_kyu BETWEEN 1 AND 30
      AND collection_order BETWEEN 1 AND 20
      AND jsonb_typeof(variation) = 'object'
      AND variation ? 'version'
      AND variation ? 'mainLine'
      AND variation ? 'refutations'
    )
  );
