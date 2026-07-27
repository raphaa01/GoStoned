DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_status_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_status_check CHECK (status IN ('active', 'finished'));
  END IF;

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

CREATE INDEX IF NOT EXISTS idx_games_active_board
  ON games(board_size)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_games_started_at ON games(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_stats_board_rating
  ON player_stats(board_size, rating DESC, games DESC);

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON schema_migrations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON schema_migrations FROM authenticated;
  END IF;
END
$$;
