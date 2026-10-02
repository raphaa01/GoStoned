SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS learn_progress (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  completed_lesson_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_lesson_id TEXT NOT NULL DEFAULT 's1-board',
  completed_stages JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_step_by_lesson JSONB NOT NULL DEFAULT '{}'::jsonb,
  challenge_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT learn_progress_completed_lesson_ids_check CHECK (jsonb_typeof(completed_lesson_ids) = 'array'),
  CONSTRAINT learn_progress_completed_stages_check CHECK (jsonb_typeof(completed_stages) = 'array'),
  CONSTRAINT learn_progress_last_step_check CHECK (jsonb_typeof(last_step_by_lesson) = 'object'),
  CONSTRAINT learn_progress_challenge_results_check CHECK (jsonb_typeof(challenge_results) = 'object')
);

ALTER TABLE learn_progress ENABLE ROW LEVEL SECURITY;
