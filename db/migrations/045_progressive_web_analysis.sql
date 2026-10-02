-- Publish small KataGo previews while the scale-to-zero worker continues the
-- full-quality analysis in the background.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS analysis_unlimited BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE game_analysis_jobs
  ADD COLUMN IF NOT EXISTS progress JSONB;

ALTER TABLE game_analysis_jobs
  DROP CONSTRAINT IF EXISTS game_analysis_jobs_result_shape_check;

ALTER TABLE game_analysis_jobs
  ADD CONSTRAINT game_analysis_jobs_result_shape_check CHECK (
    (
      status = 'completed'
      AND result IS NOT NULL
      AND completed_at IS NOT NULL
      AND error_code IS NULL
      AND progress IS NULL
    )
    OR (
      status = 'running'
      AND completed_at IS NULL
      AND error_code IS NULL
      AND (result IS NULL OR progress IS NOT NULL)
    )
    OR (
      status IN ('queued', 'failed')
      AND result IS NULL
      AND progress IS NULL
      AND completed_at IS NULL
    )
  );

ALTER TABLE game_analysis_jobs
  DROP CONSTRAINT IF EXISTS game_analysis_jobs_progress_shape_check;

ALTER TABLE game_analysis_jobs
  ADD CONSTRAINT game_analysis_jobs_progress_shape_check CHECK (
    progress IS NULL
    OR (
      jsonb_typeof(progress) = 'object'
      AND progress->>'phase' IN ('preview', 'quality')
      AND jsonb_typeof(progress->'completedMoves') = 'number'
      AND jsonb_typeof(progress->'refinedMoves') = 'number'
      AND jsonb_typeof(progress->'totalMoves') = 'number'
    )
  );

UPDATE users
   SET analysis_unlimited = true,
       updated_at = NOW()
 WHERE LOWER(username) = 'rapha';
