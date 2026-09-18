-- Daily puzzles are fixed catalog content. Only practice puzzles remain worker jobs.
DELETE FROM puzzle_generation_jobs
 WHERE kind = 'daily';

ALTER TABLE puzzles
  DROP CONSTRAINT IF EXISTS puzzles_visits_check;
ALTER TABLE puzzles
  ADD CONSTRAINT puzzles_visits_check CHECK (visits BETWEEN 0 AND 10000);

-- A deployment may replace today's former KataGo variation with its static,
-- one-move catalog answer. Clear only unfinished variation progress so the
-- existing daily row and completed attempts remain valid.
UPDATE puzzle_attempts attempt
   SET variation_progress = '[]'::jsonb,
       variation_revision = LEAST(1000, attempt.variation_revision + 1)
 WHERE NOT attempt.solved
   AND attempt.puzzle_id IN (
     SELECT id
       FROM puzzles
      WHERE kind = 'daily'
        AND daily_date >= CURRENT_DATE
   );
