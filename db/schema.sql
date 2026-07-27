CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  display_name TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
  ON users(LOWER(username));

CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  black_player_key TEXT NOT NULL,
  white_player_key TEXT NOT NULL,
  winner_key TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  result TEXT,
  komi NUMERIC(4,1) NOT NULL DEFAULT 6.5,
  rules TEXT NOT NULL DEFAULT 'chinese',
  version INT NOT NULL DEFAULT 0,
  started_at TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moves (
  id BIGSERIAL PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  move_number INT NOT NULL,
  color TEXT NOT NULL CHECK (color IN ('black', 'white')),
  x INT,
  y INT,
  is_pass BOOLEAN DEFAULT false,
  board_hash TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (game_id, move_number),
  CHECK (
    (is_pass = true AND x IS NULL AND y IS NULL)
    OR
    (is_pass = false AND x IS NOT NULL AND y IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS matchmaking_queue (
  player_key TEXT PRIMARY KEY,
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched')),
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
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

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_messages (
  id BIGSERIAL PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL,
  message TEXT NOT NULL CHECK (
    CHAR_LENGTH(BTRIM(message)) BETWEEN 1 AND 500
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep the bootstrap idempotent when an early local prototype already created tables.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE games ADD COLUMN IF NOT EXISTS result TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS komi NUMERIC(4,1) NOT NULL DEFAULT 6.5;
ALTER TABLE games ADD COLUMN IF NOT EXISTS rules TEXT NOT NULL DEFAULT 'chinese';
ALTER TABLE games ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE moves ADD COLUMN IF NOT EXISTS board_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_board_size ON games(board_size);
CREATE INDEX IF NOT EXISTS idx_moves_game_id ON moves(game_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_player_key ON player_stats(player_key);
CREATE INDEX IF NOT EXISTS idx_player_stats_board_size ON player_stats(board_size);
CREATE INDEX IF NOT EXISTS idx_matchmaking_waiting
  ON matchmaking_queue(board_size, created_at)
  WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_matchmaking_game_id ON matchmaking_queue(game_id);
CREATE INDEX IF NOT EXISTS idx_games_active_board
  ON games(board_size)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_games_started_at ON games(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_stats_board_rating
  ON player_stats(board_size, rating DESC, games DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated_at ON auth_rate_limits(updated_at);
CREATE INDEX IF NOT EXISTS idx_game_messages_game_id_id ON game_messages(game_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_distinct_players_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_distinct_players_check
      CHECK (black_player_key <> white_player_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_winner_participant_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_winner_participant_check
      CHECK (
        winner_key IS NULL
        OR winner_key = black_player_key
        OR winner_key = white_player_key
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'matchmaking_game_state_check'
  ) THEN
    ALTER TABLE matchmaking_queue
      ADD CONSTRAINT matchmaking_game_state_check
      CHECK (
        (status = 'waiting' AND game_id IS NULL)
        OR
        (status = 'matched' AND game_id IS NOT NULL)
      );
  END IF;
END
$$;

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE matchmaking_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON schema_migrations, users, games, moves, player_stats,
      matchmaking_queue, user_sessions, auth_rate_limits, game_messages FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON schema_migrations, users, games, moves, player_stats,
      matchmaking_queue, user_sessions, auth_rate_limits, game_messages FROM authenticated;
  END IF;
END
$$;
