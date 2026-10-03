SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS board_design TEXT NOT NULL DEFAULT 'default';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_board_design_check;
ALTER TABLE users ADD CONSTRAINT users_board_design_check
  CHECK (board_design IN ('default', 'light-oak', 'dark-slate', 'white-porcelain', 'sage', 'bordeaux'));

CREATE INDEX IF NOT EXISTS idx_games_finished_winner
  ON games(winner_key)
  WHERE status = 'finished' AND finished_at IS NOT NULL AND black_player_key <> white_player_key;
