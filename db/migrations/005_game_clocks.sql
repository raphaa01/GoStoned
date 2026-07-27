ALTER TABLE games
  ADD COLUMN IF NOT EXISTS time_control TEXT NOT NULL DEFAULT 'rapid',
  ADD COLUMN IF NOT EXISTS main_time_seconds INT NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS byo_yomi_periods INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS byo_yomi_seconds INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS black_time_remaining_ms BIGINT NOT NULL DEFAULT 600000,
  ADD COLUMN IF NOT EXISTS white_time_remaining_ms BIGINT NOT NULL DEFAULT 600000,
  ADD COLUMN IF NOT EXISTS black_periods_remaining INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS white_periods_remaining INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS turn_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE matchmaking_queue
  ADD COLUMN IF NOT EXISTS time_control TEXT NOT NULL DEFAULT 'rapid';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_time_control_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_time_control_check
      CHECK (time_control IN ('blitz', 'rapid', 'classic'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_clock_values_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_clock_values_check
      CHECK (
        main_time_seconds > 0
        AND byo_yomi_periods > 0
        AND byo_yomi_seconds > 0
        AND black_time_remaining_ms >= 0
        AND white_time_remaining_ms >= 0
        AND black_periods_remaining >= 0
        AND white_periods_remaining >= 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'matchmaking_time_control_check'
  ) THEN
    ALTER TABLE matchmaking_queue
      ADD CONSTRAINT matchmaking_time_control_check
      CHECK (time_control IN ('blitz', 'rapid', 'classic'));
  END IF;
END
$$;

DROP INDEX IF EXISTS idx_matchmaking_waiting;
CREATE INDEX idx_matchmaking_waiting
  ON matchmaking_queue(board_size, time_control, created_at)
  WHERE status = 'waiting';
