-- Allow guest sessions to use the same browser-local AI fallback as accounts.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE game_browser_bot_bindings
  DROP CONSTRAINT IF EXISTS game_browser_bot_bindings_human_player_key_check;

ALTER TABLE game_browser_bot_bindings
  ADD CONSTRAINT game_browser_bot_bindings_human_player_key_check
  CHECK (human_player_key LIKE 'user:%' OR human_player_key LIKE 'guest:%')
  NOT VALID;

ALTER TABLE game_browser_bot_bindings
  VALIDATE CONSTRAINT game_browser_bot_bindings_human_player_key_check;
