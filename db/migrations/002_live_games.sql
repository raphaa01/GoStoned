ALTER TABLE games ADD COLUMN IF NOT EXISTS komi NUMERIC(4,1) NOT NULL DEFAULT 6.5;
ALTER TABLE games ADD COLUMN IF NOT EXISTS rules TEXT NOT NULL DEFAULT 'chinese';
ALTER TABLE games ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE moves ADD COLUMN IF NOT EXISTS board_hash TEXT;

CREATE TABLE IF NOT EXISTS matchmaking_queue (
  player_key TEXT PRIMARY KEY,
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched')),
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matchmaking_waiting
  ON matchmaking_queue(board_size, created_at)
  WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_matchmaking_game_id ON matchmaking_queue(game_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE matchmaking_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON users, games, moves, player_stats, matchmaking_queue FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON users, games, moves, player_stats, matchmaking_queue FROM authenticated;
  END IF;
END
$$;
