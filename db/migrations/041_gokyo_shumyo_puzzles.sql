-- Add the first 200 public-domain Gokyo Shumyo positions as a static
-- historical catalog. Worker-generated practice jobs remain limited to the
-- four modern curriculum categories.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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
      kind = 'practice'
      AND board_size = 19
      AND rank_kyu BETWEEN 1 AND 30
      AND (
        (category = 'gokyo_life' AND collection_order BETWEEN 1 AND 103)
        OR (category = 'gokyo_death' AND collection_order BETWEEN 1 AND 71)
        OR (category = 'gokyo_ko' AND collection_order BETWEEN 1 AND 26)
      )
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
      AND collection_order BETWEEN 1 AND 40
      AND jsonb_typeof(variation) = 'object'
      AND variation ? 'version'
      AND variation ? 'mainLine'
      AND variation ? 'refutations'
    )
  );
