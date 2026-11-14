ALTER TABLE tournaments ADD COLUMN rapid_game_limit INT NOT NULL DEFAULT 10
  CHECK (rapid_game_limit IN (5,10));
UPDATE tournaments SET rapid_game_limit=5
  WHERE kind='monthly' AND monthly_mode='rapid' AND status='finished';

ALTER TABLE tournament_members ADD COLUMN final_standing JSONB;
