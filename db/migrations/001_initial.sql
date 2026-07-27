CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  display_name TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  black_player_key TEXT NOT NULL,
  white_player_key TEXT NOT NULL,
  winner_key TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  result TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS moves (
  id BIGSERIAL PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  move_number INT NOT NULL,
  color TEXT NOT NULL CHECK (color IN ('black', 'white')),
  x INT,
  y INT,
  is_pass BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (game_id, move_number),
  CHECK (
    (is_pass = true AND x IS NULL AND y IS NULL)
    OR
    (is_pass = false AND x IS NOT NULL AND y IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS player_stats (
  player_key TEXT NOT NULL,
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  games INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  draws INT NOT NULL DEFAULT 0,
  rating INT NOT NULL DEFAULT 1200,
  highest_rating INT NOT NULL DEFAULT 1200,
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (player_key, board_size)
);

-- Keep the initial migration compatible with an early local prototype schema.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE games ADD COLUMN IF NOT EXISTS result TEXT;

CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_board_size ON games(board_size);
CREATE INDEX IF NOT EXISTS idx_moves_game_id ON moves(game_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_player_key ON player_stats(player_key);
CREATE INDEX IF NOT EXISTS idx_player_stats_board_size ON player_stats(board_size);
