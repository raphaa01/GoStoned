-- The former practice inventory was generated from four rotated templates.
-- Remove only that generated catalog so the worker can recreate it from the
-- 40 licensed, distinct source positions. Daily puzzles and player games stay intact.
DELETE FROM puzzle_attempts
 WHERE puzzle_id IN (
   SELECT id FROM puzzles WHERE kind = 'practice' AND category IS NOT NULL
 );

DELETE FROM puzzle_generation_jobs
 WHERE kind = 'practice' AND category IS NOT NULL;

DELETE FROM puzzles
 WHERE kind = 'practice' AND category IS NOT NULL;
