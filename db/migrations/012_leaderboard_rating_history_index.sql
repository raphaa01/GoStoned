-- gostone:migration-mode=nontransactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_player_rating_history_board_player_time
  ON player_rating_history(board_size, player_key, recorded_at, id)
  INCLUDE (game_id, rating_before, rating_after, result);
