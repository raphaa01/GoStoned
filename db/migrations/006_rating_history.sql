CREATE TABLE IF NOT EXISTS player_rating_history (
  id BIGSERIAL PRIMARY KEY,
  player_key TEXT NOT NULL,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  rating_before INT NOT NULL CHECK (rating_before >= 100),
  rating_after INT NOT NULL CHECK (rating_after >= 100),
  rating_change INT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_key, game_id),
  CHECK (rating_change = rating_after - rating_before)
);

CREATE INDEX IF NOT EXISTS idx_player_rating_history_player_board_time
  ON player_rating_history(player_key, board_size, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_rating_history_game_id
  ON player_rating_history(game_id);
CREATE INDEX IF NOT EXISTS idx_games_black_player_finished
  ON games(black_player_key, finished_at DESC)
  WHERE status = 'finished';
CREATE INDEX IF NOT EXISTS idx_games_white_player_finished
  ON games(white_player_key, finished_at DESC)
  WHERE status = 'finished';

ALTER TABLE player_rating_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON player_rating_history FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON player_rating_history FROM authenticated;
  END IF;
END
$$;
