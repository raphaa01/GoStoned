ALTER TABLE users
  ADD COLUMN IF NOT EXISTS analysis_unlimited BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE game_analysis_jobs
  ADD COLUMN IF NOT EXISTS requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_game_analysis_jobs_requester
  ON game_analysis_jobs(requested_by_user_id, created_at DESC)
  WHERE requested_by_user_id IS NOT NULL;
