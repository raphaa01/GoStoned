-- Repair installations where the migration ledger advanced without the
-- account-wide board placement preference being present.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE player_rating_preferences
  ADD COLUMN IF NOT EXISTS board_placement TEXT NOT NULL DEFAULT 'zoom';

ALTER TABLE player_rating_preferences
  DROP CONSTRAINT IF EXISTS player_rating_preferences_board_placement_check;

ALTER TABLE player_rating_preferences
  ADD CONSTRAINT player_rating_preferences_board_placement_check
  CHECK (board_placement IN ('zoom', 'direct'));
