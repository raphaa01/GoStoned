-- gostone:migration-mode=nontransactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matchmaking_waiting_pool_updated_at
  ON matchmaking_queue(board_size, time_control, rules_profile, updated_at, player_key)
  WHERE status = 'waiting';
