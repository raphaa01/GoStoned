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
  komi NUMERIC(4,1) NOT NULL DEFAULT 7.5,
  rules TEXT NOT NULL DEFAULT 'chinese',
  phase TEXT NOT NULL DEFAULT 'play' CHECK (phase IN ('play', 'scoring')),
  to_move TEXT DEFAULT 'black' CHECK (to_move IN ('black', 'white')),
  consecutive_passes INT NOT NULL DEFAULT 0 CHECK (consecutive_passes BETWEEN 0 AND 2),
  scoring_revision INT NOT NULL DEFAULT 0 CHECK (scoring_revision >= 0),
  rules_profile TEXT NOT NULL DEFAULT 'legacy-immediate-area'
    CHECK (rules_profile IN ('legacy-immediate-area', 'chinese-2002-gostone-v1')),
  scoring_method TEXT NOT NULL DEFAULT 'area' CHECK (scoring_method = 'area'),
  handicap INT NOT NULL DEFAULT 0 CHECK (handicap = 0),
  finish_reason TEXT CHECK (finish_reason IN ('score', 'resignation', 'timeout', 'legacy_score')),
  last_resume_claim TEXT,
  last_resume_by TEXT,
  last_resume_x INT,
  last_resume_y INT,
  time_control TEXT NOT NULL DEFAULT 'rapid'
    CHECK (time_control IN ('blitz', 'rapid', 'classic')),
  main_time_seconds INT NOT NULL DEFAULT 600 CHECK (main_time_seconds > 0),
  byo_yomi_periods INT NOT NULL DEFAULT 5 CHECK (byo_yomi_periods > 0),
  byo_yomi_seconds INT NOT NULL DEFAULT 30 CHECK (byo_yomi_seconds > 0),
  black_time_remaining_ms BIGINT NOT NULL DEFAULT 600000
    CHECK (black_time_remaining_ms >= 0),
  white_time_remaining_ms BIGINT NOT NULL DEFAULT 600000
    CHECK (white_time_remaining_ms >= 0),
  black_periods_remaining INT NOT NULL DEFAULT 5 CHECK (black_periods_remaining >= 0),
  white_periods_remaining INT NOT NULL DEFAULT 5 CHECK (white_periods_remaining >= 0),
  turn_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
  board_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (game_id, move_number),
  CONSTRAINT moves_board_hash_required_check CHECK (board_hash IS NOT NULL),
  CHECK (
    (is_pass = true AND x IS NULL AND y IS NULL)
    OR
    (is_pass = false AND x IS NOT NULL AND y IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS game_scoring_state (
  game_id UUID PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  board_hash TEXT NOT NULL,
  stopped_move_number INT NOT NULL CHECK (stopped_move_number >= 2),
  revision INT NOT NULL CHECK (revision > 0),
  rules TEXT NOT NULL CHECK (rules = 'chinese'),
  rules_profile TEXT NOT NULL CHECK (rules_profile = 'chinese-2002-gostone-v1'),
  scoring_method TEXT NOT NULL CHECK (scoring_method = 'area'),
  komi NUMERIC(4,1) NOT NULL,
  handicap INT NOT NULL CHECK (handicap = 0),
  fallback_to_move TEXT NOT NULL CHECK (fallback_to_move IN ('black', 'white')),
  expires_at TIMESTAMPTZ NOT NULL,
  black_confirmed_revision INT,
  white_confirmed_revision INT,
  black_confirmed_at TIMESTAMPTZ,
  white_confirmed_at TIMESTAMPTZ,
  scored_board_hash TEXT,
  black_stones INT,
  white_stones INT,
  black_territory INT,
  white_territory INT,
  neutral_points INT,
  black_dead_stones INT,
  white_dead_stones INT,
  black_total NUMERIC(6,1),
  white_total NUMERIC(6,1),
  result TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ,
  CHECK (black_stones IS NULL OR black_stones >= 0),
  CHECK (white_stones IS NULL OR white_stones >= 0),
  CHECK (black_territory IS NULL OR black_territory >= 0),
  CHECK (white_territory IS NULL OR white_territory >= 0),
  CHECK (neutral_points IS NULL OR neutral_points >= 0),
  CHECK (black_dead_stones IS NULL OR black_dead_stones >= 0),
  CHECK (white_dead_stones IS NULL OR white_dead_stones >= 0),
  CHECK (black_confirmed_revision IS NULL OR black_confirmed_revision = revision),
  CHECK (white_confirmed_revision IS NULL OR white_confirmed_revision = revision),
  CHECK ((black_confirmed_revision IS NULL) = (black_confirmed_at IS NULL)),
  CHECK ((white_confirmed_revision IS NULL) = (white_confirmed_at IS NULL)),
  CHECK (expires_at > started_at),
  CHECK (
    finalized_at IS NULL
    OR (
      black_confirmed_revision IS NOT NULL
      AND white_confirmed_revision IS NOT NULL
      AND black_confirmed_revision = revision
      AND white_confirmed_revision = revision
    )
  ),
  CHECK (
    (
      scored_board_hash IS NULL AND black_stones IS NULL AND white_stones IS NULL
      AND black_territory IS NULL AND white_territory IS NULL AND neutral_points IS NULL
      AND black_dead_stones IS NULL AND white_dead_stones IS NULL
      AND black_total IS NULL AND white_total IS NULL AND result IS NULL
      AND finalized_at IS NULL
    )
    OR
    (
      scored_board_hash IS NOT NULL AND black_stones IS NOT NULL AND white_stones IS NOT NULL
      AND black_territory IS NOT NULL AND white_territory IS NOT NULL
      AND neutral_points IS NOT NULL AND black_dead_stones IS NOT NULL
      AND white_dead_stones IS NOT NULL AND black_total IS NOT NULL
      AND white_total IS NOT NULL AND result IS NOT NULL AND finalized_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS game_dead_stones (
  game_id UUID NOT NULL REFERENCES game_scoring_state(game_id) ON DELETE CASCADE,
  x INT NOT NULL CHECK (x BETWEEN 0 AND 18),
  y INT NOT NULL CHECK (y BETWEEN 0 AND 18),
  color TEXT NOT NULL CHECK (color IN ('black', 'white')),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, x, y)
);

-- Retain the scoring snapshot and decision that caused Chinese agreement
-- scoring to resume play. The current game row keeps the latest summary for
-- API compatibility; compatible application versions append each later
-- scoring resumption here without inventing history for older games.
CREATE TABLE IF NOT EXISTS game_scoring_resume_events (
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  scoring_revision INT NOT NULL CHECK (scoring_revision > 0),
  board_hash TEXT NOT NULL,
  stopped_move_number INT NOT NULL CHECK (stopped_move_number >= 2),
  rules TEXT NOT NULL CHECK (rules = 'chinese'),
  rules_profile TEXT NOT NULL CHECK (rules_profile = 'chinese-2002-gostone-v1'),
  scoring_method TEXT NOT NULL CHECK (scoring_method = 'area'),
  komi NUMERIC(4,1) NOT NULL CHECK (komi = 7.5),
  handicap INT NOT NULL CHECK (handicap = 0),
  fallback_to_move TEXT NOT NULL CHECK (fallback_to_move IN ('black', 'white')),
  scoring_expires_at TIMESTAMPTZ NOT NULL,
  resume_claim TEXT NOT NULL CHECK (resume_claim IN ('dead', 'alive', 'deadline')),
  requested_by_color TEXT CHECK (requested_by_color IN ('black', 'white')),
  disputed_x INT CHECK (disputed_x BETWEEN 0 AND 18),
  disputed_y INT CHECK (disputed_y BETWEEN 0 AND 18),
  resumed_to_move TEXT NOT NULL CHECK (resumed_to_move IN ('black', 'white')),
  resumed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT game_scoring_resume_events_pkey PRIMARY KEY (game_id, scoring_revision),
  CONSTRAINT game_scoring_resume_events_claim_shape_check CHECK (
    (
      resume_claim = 'dead'
      AND requested_by_color IS NOT NULL
      AND disputed_x IS NOT NULL AND disputed_y IS NOT NULL
      AND resumed_to_move = requested_by_color
      AND resumed_at < scoring_expires_at
    )
    OR
    (
      resume_claim = 'alive'
      AND requested_by_color IS NOT NULL
      AND disputed_x IS NOT NULL AND disputed_y IS NOT NULL
      AND resumed_to_move <> requested_by_color
      AND resumed_at < scoring_expires_at
    )
    OR
    (
      resume_claim = 'deadline'
      AND requested_by_color IS NULL
      AND disputed_x IS NULL AND disputed_y IS NULL
      AND resumed_to_move = fallback_to_move
      AND scoring_expires_at <= resumed_at
    )
  )
);

-- Dormant, append-only authority for at most three Japanese scoring resumes.
-- The service and production rules registry intentionally do not use it yet.
CREATE TABLE IF NOT EXISTS game_japanese_resume_authorizations (
  game_id UUID NOT NULL,
  resumption_number INT NOT NULL,
  scoring_revision INT NOT NULL,
  stopped_move_number INT NOT NULL,
  stopped_board_hash TEXT NOT NULL,
  requested_by_color TEXT NOT NULL,
  rules TEXT NOT NULL,
  rules_profile TEXT NOT NULL,
  scoring_method TEXT NOT NULL,
  komi NUMERIC(4,1) NOT NULL,
  handicap INT NOT NULL,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT game_japanese_resume_authorizations_pkey
    PRIMARY KEY (game_id, resumption_number),
  CONSTRAINT game_japanese_resume_authorizations_stopped_move_key
    UNIQUE (game_id, stopped_move_number),
  CONSTRAINT game_japanese_resume_authorizations_game_fk
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  CONSTRAINT game_japanese_resume_authorizations_number_check
    CHECK (resumption_number BETWEEN 1 AND 3),
  CONSTRAINT game_japanese_resume_authorizations_revision_check
    CHECK (scoring_revision > 0),
  CONSTRAINT game_japanese_resume_authorizations_stopped_move_check
    CHECK (stopped_move_number >= 2),
  CONSTRAINT game_japanese_resume_authorizations_board_hash_check
    CHECK (LENGTH(stopped_board_hash) > 0),
  CONSTRAINT game_japanese_resume_authorizations_requested_by_check
    CHECK (requested_by_color IN ('black', 'white')),
  CONSTRAINT game_japanese_resume_authorizations_rules_check
    CHECK (rules = 'japanese'),
  CONSTRAINT game_japanese_resume_authorizations_rules_profile_check
    CHECK (rules_profile = 'japanese-1989-gostone-v1'),
  CONSTRAINT game_japanese_resume_authorizations_scoring_method_check
    CHECK (scoring_method = 'territory'),
  CONSTRAINT game_japanese_resume_authorizations_komi_check
    CHECK (komi = 6.5),
  CONSTRAINT game_japanese_resume_authorizations_handicap_check
    CHECK (handicap = 0)
);

-- Japanese scoring intentionally has no automatic response deadline or
-- fallback turn. A future service must either settle by mutual agreement or
-- resume actual play with the requester's opponent moving first.
-- proposal_hash is the lowercase SHA-256 of the versioned canonical
-- japanese-settlement-proposal-v1 serialization defined by the inactive
-- policy contract; activation must implement and recompute that serializer.
CREATE TABLE IF NOT EXISTS game_japanese_scoring_state (
  game_id UUID PRIMARY KEY,
  board_hash TEXT NOT NULL,
  stopped_move_number INT NOT NULL CHECK (stopped_move_number >= 2),
  revision INT NOT NULL CHECK (revision > 0),
  proposal_hash TEXT NOT NULL CHECK (proposal_hash ~ '^[0-9a-f]{64}$'),
  rules TEXT NOT NULL DEFAULT 'japanese' CHECK (rules = 'japanese'),
  rules_profile TEXT NOT NULL DEFAULT 'japanese-1989-gostone-v1'
    CHECK (rules_profile = 'japanese-1989-gostone-v1'),
  scoring_method TEXT NOT NULL DEFAULT 'territory'
    CHECK (scoring_method = 'territory'),
  komi NUMERIC(4,1) NOT NULL DEFAULT 6.5 CHECK (komi = 6.5),
  handicap INT NOT NULL DEFAULT 0 CHECK (handicap = 0),
  captured_white_by_black_at_stop INT NOT NULL
    CHECK (captured_white_by_black_at_stop >= 0),
  captured_black_by_white_at_stop INT NOT NULL
    CHECK (captured_black_by_white_at_stop >= 0),
  black_confirmed_revision INT,
  white_confirmed_revision INT,
  black_confirmed_proposal_hash TEXT,
  white_confirmed_proposal_hash TEXT,
  black_confirmed_at TIMESTAMPTZ,
  white_confirmed_at TIMESTAMPTZ,
  scored_board_hash TEXT,
  scored_proposal_hash TEXT,
  living_black_stones INT,
  living_white_stones INT,
  black_territory INT,
  white_territory INT,
  dame_points INT,
  territory_excluded_by_agreement INT,
  dead_black_stones INT,
  dead_white_stones INT,
  black_prisoners_final INT,
  white_prisoners_final INT,
  black_total NUMERIC(6,1),
  white_total NUMERIC(6,1),
  outcome_kind TEXT,
  winner TEXT,
  margin NUMERIC(6,1),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ,
  UNIQUE (game_id, revision, proposal_hash),
  CHECK (
    (
      black_confirmed_revision IS NULL
      AND black_confirmed_proposal_hash IS NULL
      AND black_confirmed_at IS NULL
    )
    OR
    (
      black_confirmed_revision IS NOT NULL
      AND black_confirmed_revision = revision
      AND black_confirmed_proposal_hash IS NOT NULL
      AND black_confirmed_proposal_hash = proposal_hash
      AND black_confirmed_at IS NOT NULL
    )
  ),
  CHECK (
    (
      white_confirmed_revision IS NULL
      AND white_confirmed_proposal_hash IS NULL
      AND white_confirmed_at IS NULL
    )
    OR
    (
      white_confirmed_revision IS NOT NULL
      AND white_confirmed_revision = revision
      AND white_confirmed_proposal_hash IS NOT NULL
      AND white_confirmed_proposal_hash = proposal_hash
      AND white_confirmed_at IS NOT NULL
    )
  ),
  CHECK (living_black_stones IS NULL OR living_black_stones >= 0),
  CHECK (living_white_stones IS NULL OR living_white_stones >= 0),
  CHECK (black_territory IS NULL OR black_territory >= 0),
  CHECK (white_territory IS NULL OR white_territory >= 0),
  CHECK (dame_points IS NULL OR dame_points >= 0),
  CHECK (
    territory_excluded_by_agreement IS NULL
    OR territory_excluded_by_agreement >= 0
  ),
  CHECK (dead_black_stones IS NULL OR dead_black_stones >= 0),
  CHECK (dead_white_stones IS NULL OR dead_white_stones >= 0),
  CHECK (black_prisoners_final IS NULL OR black_prisoners_final >= 0),
  CHECK (white_prisoners_final IS NULL OR white_prisoners_final >= 0),
  CHECK (black_total IS NULL OR black_total >= 0),
  CHECK (white_total IS NULL OR white_total >= 0),
  CHECK (margin IS NULL OR margin >= 0),
  CHECK (outcome_kind IS NULL OR outcome_kind IN ('points', 'jigo')),
  CHECK (winner IS NULL OR winner IN ('black', 'white')),
  CHECK (
    finalized_at IS NULL
    OR (
      black_confirmed_revision IS NOT NULL
      AND black_confirmed_revision = revision
      AND white_confirmed_revision IS NOT NULL
      AND white_confirmed_revision = revision
      AND black_confirmed_proposal_hash IS NOT NULL
      AND black_confirmed_proposal_hash = proposal_hash
      AND white_confirmed_proposal_hash IS NOT NULL
      AND white_confirmed_proposal_hash = proposal_hash
      AND black_confirmed_at IS NOT NULL
      AND white_confirmed_at IS NOT NULL
    )
  ),
  CHECK (
    (
      scored_board_hash IS NULL AND scored_proposal_hash IS NULL
      AND living_black_stones IS NULL AND living_white_stones IS NULL
      AND black_territory IS NULL AND white_territory IS NULL
      AND dame_points IS NULL AND territory_excluded_by_agreement IS NULL
      AND dead_black_stones IS NULL AND dead_white_stones IS NULL
      AND black_prisoners_final IS NULL AND white_prisoners_final IS NULL
      AND black_total IS NULL AND white_total IS NULL
      AND outcome_kind IS NULL AND winner IS NULL AND margin IS NULL
      AND finalized_at IS NULL
    )
    OR
    (
      scored_board_hash IS NOT NULL
      AND scored_proposal_hash IS NOT NULL
      AND scored_proposal_hash = proposal_hash
      AND living_black_stones IS NOT NULL AND living_white_stones IS NOT NULL
      AND black_territory IS NOT NULL AND white_territory IS NOT NULL
      AND dame_points IS NOT NULL AND territory_excluded_by_agreement IS NOT NULL
      AND dead_black_stones IS NOT NULL AND dead_white_stones IS NOT NULL
      AND black_prisoners_final IS NOT NULL AND white_prisoners_final IS NOT NULL
      AND black_total IS NOT NULL AND white_total IS NOT NULL
      AND outcome_kind IS NOT NULL AND margin IS NOT NULL
      AND finalized_at IS NOT NULL
      AND black_prisoners_final = captured_white_by_black_at_stop + dead_white_stones
      AND white_prisoners_final = captured_black_by_white_at_stop + dead_black_stones
      AND black_total = black_territory + black_prisoners_final
      AND white_total = white_territory + white_prisoners_final + komi
      AND margin = ABS(black_total - white_total)
      AND (
        (
          outcome_kind = 'jigo'
          AND winner IS NULL
          AND black_total = white_total
          AND margin = 0
        )
        OR
        (
          outcome_kind = 'points'
          AND winner IS NOT NULL
          AND winner = CASE WHEN black_total > white_total THEN 'black' ELSE 'white' END
          AND black_total <> white_total
          AND margin > 0
        )
      )
    )
  )
);

CREATE TABLE IF NOT EXISTS game_japanese_dead_stones (
  game_id UUID NOT NULL,
  revision INT NOT NULL CHECK (revision > 0),
  proposal_hash TEXT NOT NULL CHECK (proposal_hash ~ '^[0-9a-f]{64}$'),
  x INT NOT NULL CHECK (x BETWEEN 0 AND 18),
  y INT NOT NULL CHECK (y BETWEEN 0 AND 18),
  color TEXT NOT NULL CHECK (color IN ('black', 'white')),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, x, y),
  FOREIGN KEY (game_id, revision, proposal_hash)
    REFERENCES game_japanese_scoring_state(game_id, revision, proposal_hash)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_japanese_neutral_region_seeds (
  game_id UUID NOT NULL,
  revision INT NOT NULL CHECK (revision > 0),
  proposal_hash TEXT NOT NULL CHECK (proposal_hash ~ '^[0-9a-f]{64}$'),
  x INT NOT NULL CHECK (x BETWEEN 0 AND 18),
  y INT NOT NULL CHECK (y BETWEEN 0 AND 18),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, x, y),
  FOREIGN KEY (game_id, revision, proposal_hash)
    REFERENCES game_japanese_scoring_state(game_id, revision, proposal_hash)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS matchmaking_queue (
  player_key TEXT PRIMARY KEY,
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  time_control TEXT NOT NULL DEFAULT 'rapid'
    CHECK (time_control IN ('blitz', 'rapid', 'classic')),
  rules_profile TEXT NOT NULL DEFAULT 'chinese-2002-gostone-v1',
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched')),
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT matchmaking_queue_rules_profile_compatibility_check CHECK (
    rules_profile IN ('legacy-immediate-area', 'chinese-2002-gostone-v1')
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

CREATE TABLE IF NOT EXISTS player_rating_history (
  id BIGSERIAL PRIMARY KEY,
  player_key TEXT NOT NULL,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  rating_before INT NOT NULL CHECK (rating_before >= 100),
  rating_after INT NOT NULL CHECK (rating_after >= 100),
  rating_change INT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_key, game_id),
  CHECK (rating_change = rating_after - rating_before)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guest_sessions (
  guest_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

CREATE TABLE IF NOT EXISTS player_blocks (
  blocker_key TEXT NOT NULL,
  blocked_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_blocks_pkey PRIMARY KEY (blocker_key, blocked_key),
  CONSTRAINT player_blocks_distinct_players_check CHECK (blocker_key <> blocked_key),
  CONSTRAINT player_blocks_key_bounds_check CHECK (
    blocker_key ~ '^(user|guest):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND blocked_key ~ '^(user|guest):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);

CREATE TABLE IF NOT EXISTS player_reports (
  game_id UUID NOT NULL,
  reporter_key TEXT NOT NULL,
  reported_key TEXT NOT NULL,
  category_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_reports_pkey PRIMARY KEY (game_id, reporter_key),
  CONSTRAINT player_reports_game_fk FOREIGN KEY (game_id)
    REFERENCES games(id) ON DELETE RESTRICT,
  CONSTRAINT player_reports_distinct_players_check CHECK (reporter_key <> reported_key),
  CONSTRAINT player_reports_key_bounds_check CHECK (
    reporter_key ~ '^(user|guest):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND reported_key ~ '^(user|guest):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT player_reports_category_check CHECK (
    category_code IN (
      'abuse_or_hate',
      'threat_or_sexual_safety',
      'fair_play',
      'stalling_or_abandonment',
      'spam_scam_or_identity',
      'other'
    )
  )
);

-- Keep the bootstrap idempotent when an early local prototype already created tables.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE games ADD COLUMN IF NOT EXISTS result TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS komi NUMERIC(4,1) NOT NULL DEFAULT 7.5;
ALTER TABLE games ADD COLUMN IF NOT EXISTS rules TEXT NOT NULL DEFAULT 'chinese';
ALTER TABLE games ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'play';
ALTER TABLE games ADD COLUMN IF NOT EXISTS to_move TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS consecutive_passes INT NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS scoring_revision INT NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS rules_profile TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS scoring_method TEXT NOT NULL DEFAULT 'area';
ALTER TABLE games ADD COLUMN IF NOT EXISTS handicap INT NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS finish_reason TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS last_resume_claim TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS last_resume_by TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS last_resume_x INT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS last_resume_y INT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS time_control TEXT NOT NULL DEFAULT 'rapid';
ALTER TABLE games ADD COLUMN IF NOT EXISTS main_time_seconds INT NOT NULL DEFAULT 600;
ALTER TABLE games ADD COLUMN IF NOT EXISTS byo_yomi_periods INT NOT NULL DEFAULT 5;
ALTER TABLE games ADD COLUMN IF NOT EXISTS byo_yomi_seconds INT NOT NULL DEFAULT 30;
ALTER TABLE games ADD COLUMN IF NOT EXISTS black_time_remaining_ms BIGINT NOT NULL DEFAULT 600000;
ALTER TABLE games ADD COLUMN IF NOT EXISTS white_time_remaining_ms BIGINT NOT NULL DEFAULT 600000;
ALTER TABLE games ADD COLUMN IF NOT EXISTS black_periods_remaining INT NOT NULL DEFAULT 5;
ALTER TABLE games ADD COLUMN IF NOT EXISTS white_periods_remaining INT NOT NULL DEFAULT 5;
ALTER TABLE games ADD COLUMN IF NOT EXISTS turn_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE games ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE games ALTER COLUMN komi SET DEFAULT 7.5;
ALTER TABLE moves ADD COLUMN IF NOT EXISTS board_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'moves_board_hash_required_check'
       AND conrelid = 'public.moves'::regclass
  ) THEN
    -- Historical rows from before migration 002 may remain NULL. PostgreSQL
    -- still enforces a NOT VALID CHECK for every subsequent insert or update.
    ALTER TABLE public.moves
      ADD CONSTRAINT moves_board_hash_required_check
      CHECK (board_hash IS NOT NULL) NOT VALID;
  END IF;
END
$$;

-- Japanese 1989 Article 12: simple ko permits long cycles, but a repeated
-- whole-board position ends without result only after both players claim the
-- same current placement. Claims are minimal, exact, and append-only evidence.
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_finish_reason_check;
ALTER TABLE games
  ADD CONSTRAINT games_finish_reason_check CHECK (
    finish_reason IN (
      'score', 'resignation', 'timeout', 'legacy_score',
      'japanese_adjudication', 'japanese_no_result', 'japanese_abandonment',
      'japanese_repetition'
    )
  );

-- Durable scoring jobs adapt GoStone's exact scoring contract to the existing
-- PostgreSQL-backed local/Modal KataGo worker. No profile or job is seeded.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS katago_scoring_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_identity TEXT NOT NULL UNIQUE
    CHECK (request_identity ~ '^sha256:[0-9a-f]{64}$'),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
  scoring_revision INT NOT NULL CHECK (scoring_revision > 0),
  analysis_purpose TEXT NOT NULL
    CHECK (analysis_purpose IN ('initial-suggestion','deadline-adjudication')),
  request JSONB NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed')),
  result JSONB CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  error_code TEXT,
  error_message TEXT,
  worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT katago_scoring_jobs_request_shape_check CHECK (
    request->>'requestIdentity' = request_identity
    AND request->>'gameId' = game_id::text
    AND (request->>'scoringRevision')::INT = scoring_revision
    AND request->>'analysisPurpose' = analysis_purpose
  ),
  CONSTRAINT katago_scoring_jobs_result_shape_check CHECK (
    (status='completed' AND result IS NOT NULL AND completed_at IS NOT NULL
      AND error_code IS NULL AND error_message IS NULL)
    OR (status<>'completed' AND result IS NULL AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_katago_scoring_jobs_claim
  ON katago_scoring_jobs(status,created_at,id)
  WHERE status IN ('queued','running');

CREATE OR REPLACE FUNCTION public.validate_katago_scoring_job_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD; scoring_row RECORD;
BEGIN
  SELECT * INTO game_row FROM public.games WHERE id=NEW.game_id FOR UPDATE;
  SELECT * INTO scoring_row FROM public.game_japanese_scoring_state
   WHERE game_id=NEW.game_id FOR UPDATE;
  IF game_row.id IS NULL OR scoring_row.game_id IS NULL
    OR game_row.status<>'active' OR game_row.phase<>'scoring'
    OR game_row.rules<>'japanese'
    OR game_row.rules_profile<>'japanese-1989-gostone-v1'
    OR game_row.scoring_method<>'territory' OR game_row.komi<>6.5
    OR game_row.handicap<>0 OR scoring_row.revision<>NEW.scoring_revision
    OR NEW.request->>'stoppedBoardHash' IS DISTINCT FROM scoring_row.board_hash
    OR (NEW.request->>'stoppedMoveNumber')::INT IS DISTINCT FROM scoring_row.stopped_move_number
    OR NEW.request->'rules'->>'ruleset' IS DISTINCT FROM game_row.rules
    OR NEW.request->'rules'->>'rulesProfile' IS DISTINCT FROM game_row.rules_profile
    OR NEW.request->'rules'->>'scoringMethod' IS DISTINCT FROM game_row.scoring_method
    OR (NEW.request->'rules'->>'komi')::NUMERIC IS DISTINCT FROM game_row.komi
    OR (NEW.request->'rules'->>'handicap')::INT IS DISTINCT FROM game_row.handicap
    OR (NEW.analysis_purpose='initial-suggestion' AND scoring_row.suggestion_status<>'pending')
    OR (NEW.analysis_purpose='deadline-adjudication' AND scoring_row.expires_at>statement_timestamp())
  THEN
    RAISE EXCEPTION 'KataGo scoring job does not match the current stopped Japanese position.'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_katago_scoring_job_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'KataGo scoring jobs are retained as immutable request evidence.'
      USING ERRCODE='23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.request_identity IS DISTINCT FROM OLD.request_identity
    OR NEW.game_id IS DISTINCT FROM OLD.game_id
    OR NEW.scoring_revision IS DISTINCT FROM OLD.scoring_revision
    OR NEW.analysis_purpose IS DISTINCT FROM OLD.analysis_purpose
    OR NEW.request IS DISTINCT FROM OLD.request
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.status='completed'
  THEN
    RAISE EXCEPTION 'KataGo scoring request identity is immutable.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.validate_katago_scoring_job_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_katago_scoring_job_mutation() FROM PUBLIC;

CREATE TRIGGER katago_scoring_job_insert_guard BEFORE INSERT ON katago_scoring_jobs
  FOR EACH ROW EXECUTE FUNCTION public.validate_katago_scoring_job_insert();
CREATE TRIGGER katago_scoring_job_update_guard BEFORE UPDATE ON katago_scoring_jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_katago_scoring_job_mutation();
CREATE TRIGGER katago_scoring_job_delete_guard BEFORE DELETE ON katago_scoring_jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_katago_scoring_job_mutation();
CREATE TRIGGER katago_scoring_job_truncate_guard BEFORE TRUNCATE ON katago_scoring_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_katago_scoring_job_mutation();

ALTER TABLE katago_scoring_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katago_scoring_jobs FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gostone_app') THEN
    GRANT SELECT,INSERT,UPDATE ON katago_scoring_jobs TO gostone_app;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='katago_scoring_jobs' AND policyname='gostone_app_server_access') THEN
      CREATE POLICY gostone_app_server_access ON katago_scoring_jobs
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON katago_scoring_jobs FROM anon;
    REVOKE ALL ON FUNCTION public.validate_katago_scoring_job_insert(),
      public.guard_katago_scoring_job_mutation() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON katago_scoring_jobs FROM authenticated;
    REVOKE ALL ON FUNCTION public.validate_katago_scoring_job_insert(),
      public.guard_katago_scoring_job_mutation() FROM authenticated;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS game_japanese_repetition_claims (
  game_id UUID NOT NULL,
  move_number INT NOT NULL CHECK (move_number > 0),
  claimant_color TEXT NOT NULL CHECK (claimant_color IN ('black', 'white')),
  repeated_from_move_number INT NOT NULL CHECK (
    repeated_from_move_number > 0 AND repeated_from_move_number < move_number
  ),
  board_hash TEXT NOT NULL CHECK (BTRIM(board_hash) <> ''),
  rules TEXT NOT NULL CHECK (rules = 'japanese'),
  rules_profile TEXT NOT NULL CHECK (rules_profile = 'japanese-1989-gostone-v1'),
  scoring_method TEXT NOT NULL CHECK (scoring_method = 'territory'),
  komi NUMERIC(4,1) NOT NULL CHECK (komi = 6.5),
  handicap INT NOT NULL CHECK (handicap = 0),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT game_japanese_repetition_claims_pkey
    PRIMARY KEY (game_id, move_number, claimant_color),
  CONSTRAINT game_japanese_repetition_claims_game_fk
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE RESTRICT,
  CONSTRAINT game_japanese_repetition_claims_move_fk
    FOREIGN KEY (game_id, move_number) REFERENCES moves(game_id, move_number) ON DELETE RESTRICT,
  CONSTRAINT game_japanese_repetition_claims_prior_move_fk
    FOREIGN KEY (game_id, repeated_from_move_number)
    REFERENCES moves(game_id, move_number) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.validate_japanese_repetition_claim_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD; current_move RECORD;
BEGIN
  SELECT * INTO game_row FROM public.games WHERE id = NEW.game_id FOR UPDATE;
  SELECT move.move_number, move.is_pass, move.board_hash INTO current_move
    FROM public.moves AS move
   WHERE move.game_id = NEW.game_id
   ORDER BY move.move_number DESC LIMIT 1;
  IF NOT FOUND
    OR game_row.status <> 'active' OR game_row.phase <> 'play'
    OR game_row.rules <> 'japanese'
    OR game_row.rules_profile <> 'japanese-1989-gostone-v1'
    OR game_row.scoring_method <> 'territory' OR game_row.komi <> 6.5
    OR game_row.handicap <> 0
    OR current_move.move_number IS DISTINCT FROM NEW.move_number
    OR current_move.is_pass
    OR current_move.board_hash IS DISTINCT FROM NEW.board_hash
    OR NOT EXISTS (
      SELECT 1 FROM public.moves AS prior
       WHERE prior.game_id = NEW.game_id
         AND prior.move_number = NEW.repeated_from_move_number
         AND prior.board_hash = NEW.board_hash
    )
  THEN
    RAISE EXCEPTION 'Japanese repetition claim must match the current repeated placement.'
      USING ERRCODE = '23514';
  END IF;
  NEW.claimed_at := statement_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_japanese_repetition_claim_commit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD; matching_claims INT;
BEGIN
  SELECT * INTO game_row FROM public.games WHERE id = NEW.game_id;
  SELECT COUNT(*)::INT INTO matching_claims
    FROM public.game_japanese_repetition_claims AS claim
   WHERE claim.game_id = NEW.game_id
     AND claim.move_number = NEW.move_number
     AND claim.board_hash = NEW.board_hash;
  IF game_row.id IS NULL OR (
    game_row.status = 'finished' AND (
      game_row.finish_reason <> 'japanese_repetition'
      OR game_row.phase <> 'play' OR game_row.to_move IS NOT NULL
      OR game_row.winner_key IS NOT NULL OR game_row.result <> 'Void'
      OR matching_claims <> 2
    )
  ) THEN
    RAISE EXCEPTION 'Japanese repetition evidence does not match the game lifecycle.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_japanese_repetition_finish()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE matching_claims INT;
BEGIN
  IF NEW.finish_reason IS DISTINCT FROM 'japanese_repetition' THEN RETURN NEW; END IF;
  SELECT COUNT(*)::INT INTO matching_claims
    FROM public.game_japanese_repetition_claims AS claim
   WHERE claim.game_id = NEW.id
     AND claim.move_number = (SELECT MAX(move_number) FROM public.moves WHERE game_id = NEW.id)
     AND claim.board_hash = (SELECT board_hash FROM public.moves WHERE game_id = NEW.id ORDER BY move_number DESC LIMIT 1);
  IF OLD.status <> 'active' OR OLD.phase <> 'play'
    OR NEW.status <> 'finished' OR NEW.phase <> 'play' OR NEW.to_move IS NOT NULL
    OR NEW.winner_key IS NOT NULL OR NEW.result <> 'Void' OR matching_claims <> 2
  THEN
    RAISE EXCEPTION 'Japanese repetition finish requires matching claims from both players.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_japanese_repetition_claim_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Japanese repetition claims are append-only.' USING ERRCODE = '23514';
END
$$;

REVOKE ALL ON FUNCTION public.validate_japanese_repetition_claim_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_japanese_repetition_claim_commit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_japanese_repetition_finish() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_japanese_repetition_claim_mutation() FROM PUBLIC;

CREATE TRIGGER game_japanese_repetition_claim_insert_guard
  BEFORE INSERT ON game_japanese_repetition_claims FOR EACH ROW
  EXECUTE FUNCTION public.validate_japanese_repetition_claim_insert();
CREATE CONSTRAINT TRIGGER game_japanese_repetition_claim_commit_guard
  AFTER INSERT ON game_japanese_repetition_claims DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_japanese_repetition_claim_commit();
CREATE TRIGGER game_japanese_repetition_claim_immutable_guard
  BEFORE UPDATE OR DELETE ON game_japanese_repetition_claims FOR EACH ROW
  EXECUTE FUNCTION public.guard_japanese_repetition_claim_mutation();
CREATE TRIGGER game_japanese_repetition_claim_truncate_guard
  BEFORE TRUNCATE ON game_japanese_repetition_claims FOR EACH STATEMENT
  EXECUTE FUNCTION public.guard_japanese_repetition_claim_mutation();
CREATE TRIGGER game_japanese_repetition_finish_guard
  BEFORE UPDATE OF status, phase, to_move, finish_reason, result, winner_key ON games
  FOR EACH ROW EXECUTE FUNCTION public.guard_japanese_repetition_finish();

ALTER TABLE game_japanese_repetition_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game_japanese_repetition_claims FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON game_japanese_repetition_claims FROM anon;
    REVOKE ALL ON FUNCTION public.validate_japanese_repetition_claim_insert(),
      public.validate_japanese_repetition_claim_commit(),
      public.guard_japanese_repetition_finish(),
      public.guard_japanese_repetition_claim_mutation() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON game_japanese_repetition_claims FROM authenticated;
    REVOKE ALL ON FUNCTION public.validate_japanese_repetition_claim_insert(),
      public.validate_japanese_repetition_claim_commit(),
      public.guard_japanese_repetition_finish(),
      public.guard_japanese_repetition_claim_mutation() FROM authenticated;
  END IF;
END $$;
ALTER TABLE matchmaking_queue ADD COLUMN IF NOT EXISTS time_control TEXT NOT NULL DEFAULT 'rapid';
ALTER TABLE matchmaking_queue
  ADD COLUMN IF NOT EXISTS rules_profile TEXT NOT NULL
    DEFAULT 'chinese-2002-gostone-v1';

UPDATE games g
   SET to_move = CASE
     WHEN (SELECT COUNT(*) FROM moves m WHERE m.game_id = g.id) % 2 = 0
       THEN 'black'
     ELSE 'white'
   END
 WHERE g.status = 'active'
   AND g.to_move IS NULL;

ALTER TABLE games ALTER COLUMN to_move SET DEFAULT 'black';

UPDATE games
   SET rules_profile = 'legacy-immediate-area'
 WHERE rules_profile IS NULL;

ALTER TABLE games
  -- Keep schema application backward-compatible with application instances
  -- that predate scoring agreement. New matchmaking opts in explicitly.
  ALTER COLUMN rules_profile SET DEFAULT 'legacy-immediate-area',
  ALTER COLUMN rules_profile SET NOT NULL;

UPDATE matchmaking_queue AS queue
   SET rules_profile = games.rules_profile
  FROM games
 WHERE queue.status = 'matched'
   AND queue.game_id = games.id;

UPDATE matchmaking_queue
   SET rules_profile = 'chinese-2002-gostone-v1'
 WHERE status = 'waiting';

-- Preserve mixed-version rollout compatibility while keeping matched queue
-- metadata truthful. Waiting rows may retain either supported Chinese profile;
-- current writers explicitly request the current profile.
CREATE OR REPLACE FUNCTION public.enforce_matchmaking_rules_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  linked_profile TEXT;
BEGIN
  IF NEW.status = 'matched' THEN
    SELECT rules_profile
      INTO linked_profile
      FROM public.games
     WHERE id = NEW.game_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Matched queue row must reference an existing game.'
        USING ERRCODE = '23503';
    END IF;
    NEW.rules_profile := linked_profile;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_matchmaking_rules_profile() FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'matchmaking_rules_profile_guard'
       AND tgrelid = 'public.matchmaking_queue'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER matchmaking_rules_profile_guard
      BEFORE INSERT OR UPDATE OF status, game_id, rules_profile
      ON public.matchmaking_queue
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_matchmaking_rules_profile();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_game_rules_identity_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (
    NEW.rules IS DISTINCT FROM OLD.rules
    OR NEW.rules_profile IS DISTINCT FROM OLD.rules_profile
    OR NEW.scoring_method IS DISTINCT FROM OLD.scoring_method
    OR NEW.komi IS DISTINCT FROM OLD.komi
    OR NEW.handicap IS DISTINCT FROM OLD.handicap
  ) THEN
    RAISE EXCEPTION 'A game rules identity cannot change after creation.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_game_scoring_resume_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Game scoring resume evidence is append-only.'
      USING ERRCODE = '23514';
  END IF;
  -- Permit the database-owned cascade only after its parent game is gone.
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM public.games WHERE id = OLD.game_id;
    IF NOT FOUND THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'Game scoring resume evidence is append-only.'
    USING ERRCODE = '23514';
END
$$;

CREATE OR REPLACE FUNCTION public.validate_game_scoring_resume_event_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  snapshot RECORD;
BEGIN
  SELECT
      game.board_size,
      game.status,
      game.phase,
      game.scoring_revision AS game_scoring_revision,
      game.rules,
      game.rules_profile,
      game.scoring_method,
      game.komi,
      game.handicap,
      scoring.board_hash,
      scoring.stopped_move_number,
      scoring.revision AS snapshot_revision,
      scoring.fallback_to_move,
      scoring.expires_at
    INTO snapshot
    FROM public.games AS game
    JOIN public.game_scoring_state AS scoring ON scoring.game_id = game.id
   WHERE game.id = NEW.game_id
   FOR SHARE OF game, scoring;

  IF NOT FOUND
    OR snapshot.status <> 'active'
    OR snapshot.phase <> 'scoring'
    OR NEW.scoring_revision IS DISTINCT FROM snapshot.game_scoring_revision
    OR NEW.scoring_revision IS DISTINCT FROM snapshot.snapshot_revision
    OR NEW.board_hash IS DISTINCT FROM snapshot.board_hash
    OR NEW.stopped_move_number IS DISTINCT FROM snapshot.stopped_move_number
    OR NEW.rules IS DISTINCT FROM snapshot.rules
    OR NEW.rules_profile IS DISTINCT FROM snapshot.rules_profile
    OR NEW.scoring_method IS DISTINCT FROM snapshot.scoring_method
    OR NEW.komi IS DISTINCT FROM snapshot.komi
    OR NEW.handicap IS DISTINCT FROM snapshot.handicap
    OR NEW.fallback_to_move IS DISTINCT FROM snapshot.fallback_to_move
    OR NEW.scoring_expires_at IS DISTINCT FROM snapshot.expires_at
  THEN
    RAISE EXCEPTION 'Resume evidence must match the active scoring snapshot.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.disputed_x IS NOT NULL AND (
    NEW.disputed_x < 0 OR NEW.disputed_x >= snapshot.board_size
    OR NEW.disputed_y < 0 OR NEW.disputed_y >= snapshot.board_size
  ) THEN
    RAISE EXCEPTION 'Resume evidence coordinates are outside the game board.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resume_claim IN ('dead', 'alive') AND NOT EXISTS (
    SELECT 1
      FROM public.game_dead_stones AS dead_stone
     WHERE dead_stone.game_id = NEW.game_id
       AND dead_stone.x = NEW.disputed_x
       AND dead_stone.y = NEW.disputed_y
  ) THEN
    RAISE EXCEPTION 'Resume evidence must identify a marked dead stone.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_game_scoring_resume_event_commit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  lifecycle RECORD;
BEGIN
  SELECT
      game.status,
      game.phase,
      game.to_move,
      game.finish_reason,
      game.scoring_revision,
      game.last_resume_claim,
      game.last_resume_by,
      game.last_resume_x,
      game.last_resume_y,
      EXISTS (
        SELECT 1
          FROM public.game_scoring_state AS scoring
         WHERE scoring.game_id = game.id
      ) AS has_scoring_state
    INTO lifecycle
    FROM public.games AS game
   WHERE game.id = NEW.game_id;

  IF NOT FOUND
    OR NOT (
      (
        lifecycle.status = 'active'
        AND lifecycle.phase = 'play'
        AND lifecycle.to_move IS NOT DISTINCT FROM NEW.resumed_to_move
      )
      OR
      (
        lifecycle.status = 'finished'
        AND lifecycle.phase = 'play'
        AND lifecycle.to_move IS NULL
        AND lifecycle.finish_reason IN ('resignation', 'timeout')
      )
    )
    OR lifecycle.scoring_revision IS DISTINCT FROM NEW.scoring_revision + 1
    OR lifecycle.last_resume_claim IS DISTINCT FROM NEW.resume_claim
    OR lifecycle.last_resume_by IS DISTINCT FROM NEW.requested_by_color
    OR lifecycle.last_resume_x IS DISTINCT FROM NEW.disputed_x
    OR lifecycle.last_resume_y IS DISTINCT FROM NEW.disputed_y
    OR lifecycle.has_scoring_state
  THEN
    RAISE EXCEPTION 'Resume evidence requires a completed scoring-to-play transition.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_game_japanese_resume_authorization_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Japanese resume authorizations are append-only.'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM public.games WHERE id = OLD.game_id;
    IF NOT FOUND THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'Japanese resume authorizations are append-only.'
    USING ERRCODE = '23514';
END
$$;

CREATE OR REPLACE FUNCTION public.validate_game_japanese_resume_authorization_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  game_snapshot RECORD;
  scoring_snapshot RECORD;
  latest_move RECORD;
  prior_move RECORD;
  expected_resumption_number INT;
BEGIN
  SELECT game.status, game.phase, game.to_move, game.consecutive_passes,
      game.scoring_revision, game.rules, game.rules_profile,
      game.scoring_method, game.komi, game.handicap
    INTO game_snapshot
    FROM public.games AS game
   WHERE game.id = NEW.game_id
   FOR UPDATE;

  IF NOT FOUND
    OR game_snapshot.status <> 'active'
    OR game_snapshot.phase <> 'scoring'
    OR game_snapshot.to_move IS NOT NULL
    OR game_snapshot.consecutive_passes <> 2
    OR game_snapshot.rules <> 'japanese'
    OR game_snapshot.rules_profile <> 'japanese-1989-gostone-v1'
    OR game_snapshot.scoring_method <> 'territory'
    OR game_snapshot.komi <> 6.5
    OR game_snapshot.handicap <> 0
    OR NEW.rules IS DISTINCT FROM game_snapshot.rules
    OR NEW.rules_profile IS DISTINCT FROM game_snapshot.rules_profile
    OR NEW.scoring_method IS DISTINCT FROM game_snapshot.scoring_method
    OR NEW.komi IS DISTINCT FROM game_snapshot.komi
    OR NEW.handicap IS DISTINCT FROM game_snapshot.handicap
  THEN
    RAISE EXCEPTION 'Japanese resume authorization requires an active stopped Japanese game.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(MAX(resumption_number), 0) + 1
    INTO expected_resumption_number
    FROM public.game_japanese_resume_authorizations
   WHERE game_id = NEW.game_id;
  IF expected_resumption_number > 3
    OR NEW.resumption_number IS DISTINCT FROM expected_resumption_number
  THEN
    RAISE EXCEPTION 'Japanese games permit at most three ordered scoring resumptions.'
      USING ERRCODE = '23514';
  END IF;

  SELECT scoring.board_hash, scoring.stopped_move_number, scoring.revision,
      scoring.rules, scoring.rules_profile, scoring.scoring_method,
      scoring.komi, scoring.handicap, scoring.black_confirmed_revision,
      scoring.white_confirmed_revision, scoring.finalized_at
    INTO scoring_snapshot
    FROM public.game_japanese_scoring_state AS scoring
   WHERE scoring.game_id = NEW.game_id
   FOR UPDATE;

  IF NOT FOUND
    OR scoring_snapshot.finalized_at IS NOT NULL
    OR (
      scoring_snapshot.black_confirmed_revision IS NOT NULL
      AND scoring_snapshot.white_confirmed_revision IS NOT NULL
    )
    OR scoring_snapshot.revision IS DISTINCT FROM game_snapshot.scoring_revision
    OR NEW.scoring_revision IS DISTINCT FROM scoring_snapshot.revision
    OR NEW.stopped_board_hash IS DISTINCT FROM scoring_snapshot.board_hash
    OR NEW.stopped_move_number IS DISTINCT FROM scoring_snapshot.stopped_move_number
    OR NEW.rules IS DISTINCT FROM scoring_snapshot.rules
    OR NEW.rules_profile IS DISTINCT FROM scoring_snapshot.rules_profile
    OR NEW.scoring_method IS DISTINCT FROM scoring_snapshot.scoring_method
    OR NEW.komi IS DISTINCT FROM scoring_snapshot.komi
    OR NEW.handicap IS DISTINCT FROM scoring_snapshot.handicap
  THEN
    RAISE EXCEPTION 'Japanese resume authorization must match live unfinalized scoring state.'
      USING ERRCODE = '23514';
  END IF;

  SELECT move.move_number, move.color, move.is_pass, move.board_hash
    INTO latest_move FROM public.moves AS move
   WHERE move.game_id = NEW.game_id
   ORDER BY move.move_number DESC LIMIT 1 FOR SHARE;
  SELECT move.move_number, move.color, move.is_pass, move.board_hash
    INTO prior_move FROM public.moves AS move
   WHERE move.game_id = NEW.game_id
     AND move.move_number = NEW.stopped_move_number - 1
   FOR SHARE;
  IF latest_move.move_number IS DISTINCT FROM NEW.stopped_move_number
    OR prior_move.move_number IS DISTINCT FROM NEW.stopped_move_number - 1
    OR latest_move.is_pass IS DISTINCT FROM TRUE
    OR prior_move.is_pass IS DISTINCT FROM TRUE
    OR latest_move.board_hash IS DISTINCT FROM NEW.stopped_board_hash
    OR prior_move.board_hash IS DISTINCT FROM NEW.stopped_board_hash
    OR latest_move.color IS DISTINCT FROM (
      CASE prior_move.color WHEN 'black' THEN 'white' ELSE 'black' END
    )
  THEN
    RAISE EXCEPTION 'Japanese resume authorization requires the latest opposite-color pass-pass boundary.'
      USING ERRCODE = '23514';
  END IF;
  NEW.authorized_at := statement_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_game_japanese_resume_authorization_commit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  lifecycle RECORD;
BEGIN
  SELECT game.status, game.phase, game.to_move, game.consecutive_passes,
      game.scoring_revision, game.rules, game.rules_profile,
      game.scoring_method, game.komi, game.handicap,
      EXISTS (
        SELECT 1 FROM public.game_japanese_scoring_state AS scoring
         WHERE scoring.game_id = game.id
      ) AS has_japanese_scoring_state
    INTO lifecycle FROM public.games AS game
   WHERE game.id = NEW.game_id;
  IF NOT FOUND
    OR lifecycle.status <> 'active'
    OR lifecycle.phase <> 'play'
    OR lifecycle.consecutive_passes <> 0
    OR lifecycle.scoring_revision IS DISTINCT FROM NEW.scoring_revision + 1
    OR lifecycle.to_move IS DISTINCT FROM (
      CASE NEW.requested_by_color WHEN 'black' THEN 'white' ELSE 'black' END
    )
    OR lifecycle.rules IS DISTINCT FROM NEW.rules
    OR lifecycle.rules_profile IS DISTINCT FROM NEW.rules_profile
    OR lifecycle.scoring_method IS DISTINCT FROM NEW.scoring_method
    OR lifecycle.komi IS DISTINCT FROM NEW.komi
    OR lifecycle.handicap IS DISTINCT FROM NEW.handicap
    OR lifecycle.has_japanese_scoring_state
  THEN
    RAISE EXCEPTION 'Japanese resume authorization requires a completed opponent-first transition.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_game_japanese_resume_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  resume_snapshot RECORD;
BEGIN
  -- Only an active scoring-to-play transition is a resumption. Terminal
  -- resignation remains a separate terminal-game transition.
  IF NOT (
    OLD.rules = 'japanese'
    AND OLD.rules_profile = 'japanese-1989-gostone-v1'
    AND OLD.scoring_method = 'territory'
    AND OLD.komi = 6.5
    AND OLD.handicap = 0
    AND OLD.status = 'active'
    AND NEW.status = 'active'
    AND OLD.phase = 'scoring'
    AND NEW.phase = 'play'
  ) THEN
    RETURN NEW;
  END IF;
  SELECT scoring.revision, scoring.finalized_at,
      scoring.black_confirmed_revision, scoring.white_confirmed_revision,
      resume_authorization.scoring_revision,
      resume_authorization.resumption_number,
      resume_authorization.requested_by_color
    INTO resume_snapshot
    FROM public.game_japanese_scoring_state AS scoring
    JOIN public.game_japanese_resume_authorizations AS resume_authorization
      ON resume_authorization.game_id = scoring.game_id
     AND resume_authorization.stopped_move_number = scoring.stopped_move_number
     AND resume_authorization.scoring_revision = scoring.revision
     AND resume_authorization.stopped_board_hash = scoring.board_hash
     AND resume_authorization.rules = scoring.rules
     AND resume_authorization.rules_profile = scoring.rules_profile
     AND resume_authorization.scoring_method = scoring.scoring_method
     AND resume_authorization.komi = scoring.komi
     AND resume_authorization.handicap = scoring.handicap
   WHERE scoring.game_id = OLD.id;
  IF NOT FOUND
    OR resume_snapshot.finalized_at IS NOT NULL
    OR (
      resume_snapshot.black_confirmed_revision IS NOT NULL
      AND resume_snapshot.white_confirmed_revision IS NOT NULL
    )
    OR OLD.status <> 'active'
    OR OLD.to_move IS NOT NULL
    OR OLD.consecutive_passes <> 2
    OR OLD.scoring_revision IS DISTINCT FROM resume_snapshot.revision
    OR NEW.status <> 'active'
    OR NEW.to_move IS DISTINCT FROM (
      CASE resume_snapshot.requested_by_color WHEN 'black' THEN 'white' ELSE 'black' END
    )
    OR NEW.consecutive_passes <> 0
    OR NEW.scoring_revision IS DISTINCT FROM OLD.scoring_revision + 1
    OR OLD.scoring_revision IS DISTINCT FROM resume_snapshot.scoring_revision
    OR NEW.rules <> 'japanese'
    OR NEW.rules_profile <> 'japanese-1989-gostone-v1'
    OR NEW.scoring_method <> 'territory'
    OR NEW.komi <> 6.5
    OR NEW.handicap <> 0
  THEN
    RAISE EXCEPTION 'Japanese scoring can resume only from matching authorization evidence.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.guard_game_rules_identity_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_game_scoring_resume_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_game_scoring_resume_event_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_game_scoring_resume_event_commit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_game_japanese_resume_authorization_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_game_japanese_resume_authorization_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_game_japanese_resume_authorization_commit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_game_japanese_resume_transition() FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_rules_identity_mutation_guard'
       AND tgrelid = 'public.games'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER game_rules_identity_mutation_guard
      BEFORE UPDATE OF rules, rules_profile, scoring_method, komi, handicap
      ON public.games
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_game_rules_identity_mutation();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_japanese_scoring_state_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  proposal_inputs_changed BOOLEAN;
  authorized_resume BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.games AS game
        JOIN public.game_japanese_resume_authorizations AS resume_authorization
          ON resume_authorization.game_id = game.id
         AND resume_authorization.stopped_move_number = OLD.stopped_move_number
         AND resume_authorization.scoring_revision = OLD.revision
         AND resume_authorization.stopped_board_hash = OLD.board_hash
         AND resume_authorization.rules = OLD.rules
         AND resume_authorization.rules_profile = OLD.rules_profile
         AND resume_authorization.scoring_method = OLD.scoring_method
         AND resume_authorization.komi = OLD.komi
         AND resume_authorization.handicap = OLD.handicap
       WHERE game.id = OLD.game_id
         AND game.status = 'active'
         AND game.phase = 'play'
         AND game.consecutive_passes = 0
         AND game.scoring_revision = OLD.revision + 1
         AND game.scoring_revision = resume_authorization.scoring_revision + 1
         AND game.to_move = CASE resume_authorization.requested_by_color
           WHEN 'black' THEN 'white' ELSE 'black' END
    ) INTO authorized_resume;

    IF authorized_resume THEN
      RETURN OLD;
    END IF;

    PERFORM 1 FROM public.games WHERE id = OLD.game_id;
    IF FOUND AND (
      OLD.finalized_at IS NOT NULL
      OR OLD.black_confirmed_revision IS NOT NULL
      OR OLD.white_confirmed_revision IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Confirmed Japanese scoring state is immutable.'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.finalized_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Finalized Japanese scoring state is immutable.'
      USING ERRCODE = '23514';
  END IF;
  proposal_inputs_changed := (
    NEW.game_id IS DISTINCT FROM OLD.game_id
    OR NEW.board_hash IS DISTINCT FROM OLD.board_hash
    OR NEW.stopped_move_number IS DISTINCT FROM OLD.stopped_move_number
    OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.rules IS DISTINCT FROM OLD.rules
    OR NEW.rules_profile IS DISTINCT FROM OLD.rules_profile
    OR NEW.scoring_method IS DISTINCT FROM OLD.scoring_method
    OR NEW.komi IS DISTINCT FROM OLD.komi
    OR NEW.handicap IS DISTINCT FROM OLD.handicap
    OR NEW.captured_white_by_black_at_stop
      IS DISTINCT FROM OLD.captured_white_by_black_at_stop
    OR NEW.captured_black_by_white_at_stop
      IS DISTINCT FROM OLD.captured_black_by_white_at_stop
  );
  IF (
    OLD.black_confirmed_revision IS NOT NULL
    OR OLD.white_confirmed_revision IS NOT NULL
  ) AND (
    proposal_inputs_changed
    OR NEW.proposal_hash IS DISTINCT FROM OLD.proposal_hash
  ) THEN
    RAISE EXCEPTION 'Clear confirmations before changing a Japanese scoring proposal.'
      USING ERRCODE = '23514';
  END IF;
  IF proposal_inputs_changed
    AND NEW.proposal_hash IS NOT DISTINCT FROM OLD.proposal_hash
  THEN
    RAISE EXCEPTION 'Japanese proposal inputs require a new canonical digest.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_japanese_scoring_evidence_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_game_id UUID;
  state_row RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.game_id IS DISTINCT FROM OLD.game_id
    OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.proposal_hash IS DISTINCT FROM OLD.proposal_hash
  ) THEN
    RAISE EXCEPTION 'Japanese scoring evidence identity is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    target_game_id := OLD.game_id;
  ELSE
    target_game_id := NEW.game_id;
  END IF;

  SELECT finalized_at, black_confirmed_revision, white_confirmed_revision
    INTO state_row
    FROM public.game_japanese_scoring_state
   WHERE game_id = target_game_id
   FOR UPDATE;
  IF FOUND AND (
    state_row.finalized_at IS NOT NULL
    OR state_row.black_confirmed_revision IS NOT NULL
    OR state_row.white_confirmed_revision IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Confirmed Japanese scoring evidence is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.guard_japanese_scoring_state_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_japanese_scoring_evidence_mutation() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.enforce_matchmaking_rules_profile(),
      public.guard_game_rules_identity_mutation(),
      public.guard_game_scoring_resume_event_mutation(),
      public.validate_game_scoring_resume_event_insert(),
      public.validate_game_scoring_resume_event_commit(),
      public.guard_game_japanese_resume_authorization_mutation(),
      public.validate_game_japanese_resume_authorization_insert(),
      public.validate_game_japanese_resume_authorization_commit(),
      public.guard_game_japanese_resume_transition(),
      public.guard_japanese_scoring_state_mutation(),
      public.guard_japanese_scoring_evidence_mutation() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.enforce_matchmaking_rules_profile(),
      public.guard_game_rules_identity_mutation(),
      public.guard_game_scoring_resume_event_mutation(),
      public.validate_game_scoring_resume_event_insert(),
      public.validate_game_scoring_resume_event_commit(),
      public.guard_game_japanese_resume_authorization_mutation(),
      public.validate_game_japanese_resume_authorization_insert(),
      public.validate_game_japanese_resume_authorization_commit(),
      public.guard_game_japanese_resume_transition(),
      public.guard_japanese_scoring_state_mutation(),
      public.guard_japanese_scoring_evidence_mutation() FROM authenticated;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_scoring_resume_events_insert_guard'
       AND tgrelid = 'public.game_scoring_resume_events'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER game_scoring_resume_events_insert_guard
      BEFORE INSERT ON public.game_scoring_resume_events
      FOR EACH ROW
      EXECUTE FUNCTION public.validate_game_scoring_resume_event_insert();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_scoring_resume_events_commit_guard'
       AND tgrelid = 'public.game_scoring_resume_events'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE CONSTRAINT TRIGGER game_scoring_resume_events_commit_guard
      AFTER INSERT ON public.game_scoring_resume_events
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      EXECUTE FUNCTION public.validate_game_scoring_resume_event_commit();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_scoring_resume_events_immutable_guard'
       AND tgrelid = 'public.game_scoring_resume_events'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER game_scoring_resume_events_immutable_guard
      BEFORE UPDATE OR DELETE ON public.game_scoring_resume_events
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_game_scoring_resume_event_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_scoring_resume_events_truncate_guard'
       AND tgrelid = 'public.game_scoring_resume_events'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER game_scoring_resume_events_truncate_guard
      BEFORE TRUNCATE ON public.game_scoring_resume_events
      FOR EACH STATEMENT
      EXECUTE FUNCTION public.guard_game_scoring_resume_event_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_japanese_resume_authorizations_insert_guard'
       AND tgrelid = 'public.game_japanese_resume_authorizations'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER game_japanese_resume_authorizations_insert_guard
      BEFORE INSERT ON public.game_japanese_resume_authorizations
      FOR EACH ROW
      EXECUTE FUNCTION public.validate_game_japanese_resume_authorization_insert();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_japanese_resume_authorizations_commit_guard'
       AND tgrelid = 'public.game_japanese_resume_authorizations'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE CONSTRAINT TRIGGER game_japanese_resume_authorizations_commit_guard
      AFTER INSERT ON public.game_japanese_resume_authorizations
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      EXECUTE FUNCTION public.validate_game_japanese_resume_authorization_commit();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_japanese_resume_authorizations_immutable_guard'
       AND tgrelid = 'public.game_japanese_resume_authorizations'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER game_japanese_resume_authorizations_immutable_guard
      BEFORE UPDATE OR DELETE ON public.game_japanese_resume_authorizations
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_game_japanese_resume_authorization_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_japanese_resume_authorizations_truncate_guard'
       AND tgrelid = 'public.game_japanese_resume_authorizations'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER game_japanese_resume_authorizations_truncate_guard
      BEFORE TRUNCATE ON public.game_japanese_resume_authorizations
      FOR EACH STATEMENT
      EXECUTE FUNCTION public.guard_game_japanese_resume_authorization_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_japanese_resume_transition_guard'
       AND tgrelid = 'public.games'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER game_japanese_resume_transition_guard
      BEFORE UPDATE OF status, phase, to_move, consecutive_passes, scoring_revision
      ON public.games
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_game_japanese_resume_transition();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_japanese_scoring_state_mutation_guard'
       AND tgrelid = 'public.game_japanese_scoring_state'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER game_japanese_scoring_state_mutation_guard
      BEFORE UPDATE OR DELETE ON public.game_japanese_scoring_state
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_japanese_scoring_state_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_japanese_dead_stones_mutation_guard'
       AND tgrelid = 'public.game_japanese_dead_stones'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER game_japanese_dead_stones_mutation_guard
      BEFORE INSERT OR UPDATE OR DELETE ON public.game_japanese_dead_stones
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_japanese_scoring_evidence_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'game_japanese_neutral_seeds_mutation_guard'
       AND tgrelid = 'public.game_japanese_neutral_region_seeds'::regclass
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER game_japanese_neutral_seeds_mutation_guard
      BEFORE INSERT OR UPDATE OR DELETE ON public.game_japanese_neutral_region_seeds
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_japanese_scoring_evidence_mutation();
  END IF;
END
$$;

UPDATE games
   SET to_move = NULL,
       finish_reason = COALESCE(
         finish_reason,
         CASE
           WHEN result LIKE '%+R' THEN 'resignation'
           WHEN result LIKE '%+T' THEN 'timeout'
           ELSE 'legacy_score'
         END
       )
 WHERE status = 'finished';

UPDATE games g
   SET consecutive_passes = CASE
     WHEN EXISTS (
       SELECT 1
         FROM moves m
        WHERE m.game_id = g.id
          AND m.move_number = (
            SELECT MAX(last_move.move_number)
              FROM moves last_move
             WHERE last_move.game_id = g.id
          )
          AND m.is_pass
     ) THEN 1
     ELSE 0
   END
 WHERE g.status = 'active'
   AND g.phase = 'play';

CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_board_size ON games(board_size);
CREATE INDEX IF NOT EXISTS idx_moves_game_id ON moves(game_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_player_key ON player_stats(player_key);
CREATE INDEX IF NOT EXISTS idx_player_stats_board_size ON player_stats(board_size);
DROP INDEX IF EXISTS idx_matchmaking_waiting;
CREATE INDEX IF NOT EXISTS idx_matchmaking_waiting
  ON matchmaking_queue(board_size, time_control, created_at)
  WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_matchmaking_waiting_pool_updated_at
  ON matchmaking_queue(board_size, time_control, rules_profile, updated_at, player_key)
  WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_matchmaking_game_id ON matchmaking_queue(game_id);
CREATE INDEX IF NOT EXISTS idx_games_active_board
  ON games(board_size)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_games_started_at ON games(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_stats_board_rating
  ON player_stats(board_size, rating DESC, games DESC);
CREATE INDEX IF NOT EXISTS idx_player_rating_history_player_board_time
  ON player_rating_history(player_key, board_size, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_rating_history_board_player_time
  ON player_rating_history(board_size, player_key, recorded_at, id)
  INCLUDE (game_id, rating_before, rating_after, result);
CREATE INDEX IF NOT EXISTS idx_player_rating_history_game_id
  ON player_rating_history(game_id);
CREATE INDEX IF NOT EXISTS idx_games_black_player_finished
  ON games(black_player_key, finished_at DESC)
  WHERE status = 'finished';
CREATE INDEX IF NOT EXISTS idx_games_white_player_finished
  ON games(white_player_key, finished_at DESC)
  WHERE status = 'finished';
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_expires_at ON guest_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated_at ON auth_rate_limits(updated_at);
CREATE INDEX IF NOT EXISTS idx_game_messages_game_id_id ON game_messages(game_id, id);
CREATE INDEX IF NOT EXISTS idx_player_blocks_blocked_blocker
  ON player_blocks(blocked_key, blocker_key);
CREATE INDEX IF NOT EXISTS idx_player_blocks_guest_retention
  ON player_blocks(created_at, blocker_key, blocked_key)
  WHERE blocker_key LIKE 'guest:%' OR blocked_key LIKE 'guest:%';
CREATE INDEX IF NOT EXISTS idx_player_reports_reported_created
  ON player_reports(reported_key, created_at DESC, game_id, reporter_key);
CREATE INDEX IF NOT EXISTS idx_game_dead_stones_game_id ON game_dead_stones(game_id);
CREATE INDEX IF NOT EXISTS idx_game_japanese_dead_stones_game_id
  ON game_japanese_dead_stones(game_id);
CREATE INDEX IF NOT EXISTS idx_game_japanese_neutral_region_seeds_game_id
  ON game_japanese_neutral_region_seeds(game_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_last_resume_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_last_resume_check CHECK (
        (
          last_resume_claim IS NULL AND last_resume_by IS NULL
          AND last_resume_x IS NULL AND last_resume_y IS NULL
        )
        OR
        (
          last_resume_claim IS NOT NULL AND last_resume_claim IN ('dead', 'alive')
          AND last_resume_by IS NOT NULL AND last_resume_by IN ('black', 'white')
          AND last_resume_x IS NOT NULL AND last_resume_x BETWEEN 0 AND 18
          AND last_resume_y IS NOT NULL AND last_resume_y BETWEEN 0 AND 18
        )
        OR
        (
          last_resume_claim IS NOT NULL AND last_resume_claim = 'deadline'
          AND last_resume_by IS NULL
          AND last_resume_x IS NULL AND last_resume_y IS NULL
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_rules_profile_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_rules_profile_check
      CHECK (rules_profile IN ('legacy-immediate-area', 'chinese-2002-gostone-v1'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_phase_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_phase_check CHECK (phase IN ('play', 'scoring'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_to_move_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_to_move_check CHECK (to_move IN ('black', 'white'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_consecutive_passes_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_consecutive_passes_check CHECK (consecutive_passes BETWEEN 0 AND 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_scoring_revision_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_scoring_revision_check CHECK (scoring_revision >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_scoring_method_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_scoring_method_check CHECK (scoring_method = 'area');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_handicap_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_handicap_check CHECK (handicap = 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_rules_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_rules_check CHECK (rules = 'chinese');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_finish_reason_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_finish_reason_check
      CHECK (finish_reason IN ('score', 'resignation', 'timeout', 'legacy_score'));
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

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'matchmaking_queue_rules_profile_compatibility_check'
  ) THEN
    ALTER TABLE matchmaking_queue
      ADD CONSTRAINT matchmaking_queue_rules_profile_compatibility_check CHECK (
        rules_profile IN (
          'legacy-immediate-area',
          'chinese-2002-gostone-v1'
        )
      );
  END IF;

  -- Add exact rules-tuple bindings only after the idempotent column upgrades
  -- and data backfills above have completed. Older local prototypes may have
  -- created these tables before the tuple columns existed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'games_rules_identity_unique'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_rules_identity_unique
      UNIQUE (id, rules, rules_profile, scoring_method, komi, handicap);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'game_japanese_repetition_claims_game_rules_fk'
  ) THEN
    ALTER TABLE game_japanese_repetition_claims
      ADD CONSTRAINT game_japanese_repetition_claims_game_rules_fk
      FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)
      REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'games_supported_rules_tuple_check'
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT games_supported_rules_tuple_check CHECK (
        (
          rules = 'chinese'
          AND rules_profile = 'legacy-immediate-area'
          AND scoring_method = 'area'
          AND komi IN (6.5, 7.5)
          AND handicap = 0
        )
        OR
        (
          rules = 'chinese'
          AND rules_profile = 'chinese-2002-gostone-v1'
          AND scoring_method = 'area'
          AND komi = 7.5
          AND handicap = 0
        )
        OR
        (
          rules = 'japanese'
          AND rules_profile = 'japanese-1989-gostone-v1'
          AND scoring_method = 'territory'
          AND komi = 6.5
          AND handicap = 0
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'game_scoring_state_game_rules_fk'
  ) THEN
    ALTER TABLE game_scoring_state
      ADD CONSTRAINT game_scoring_state_game_rules_fk
      FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)
      REFERENCES games (id, rules, rules_profile, scoring_method, komi, handicap)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'game_japanese_scoring_game_rules_fk'
  ) THEN
    ALTER TABLE game_japanese_scoring_state
      ADD CONSTRAINT game_japanese_scoring_game_rules_fk
      FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)
      REFERENCES games (id, rules, rules_profile, scoring_method, komi, handicap)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'game_japanese_resume_authorizations_game_rules_fk'
       AND conrelid = 'public.game_japanese_resume_authorizations'::regclass
  ) THEN
    ALTER TABLE game_japanese_resume_authorizations
      ADD CONSTRAINT game_japanese_resume_authorizations_game_rules_fk
      FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)
      REFERENCES games (id, rules, rules_profile, scoring_method, komi, handicap)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'game_scoring_resume_events_game_rules_fk'
       AND conrelid = 'public.game_scoring_resume_events'::regclass
  ) THEN
    ALTER TABLE game_scoring_resume_events
      ADD CONSTRAINT game_scoring_resume_events_game_rules_fk
      FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)
      REFERENCES games (id, rules, rules_profile, scoring_method, komi, handicap)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END
$$;

-- Fail safely if an existing row cannot be interpreted by an exact versioned
-- tuple. The older narrow Chinese constraints remain in place, so the
-- Japanese branch is documentation until a separate activation migration.
ALTER TABLE games
  VALIDATE CONSTRAINT games_supported_rules_tuple_check;
ALTER TABLE game_scoring_state
  VALIDATE CONSTRAINT game_scoring_state_game_rules_fk;
ALTER TABLE game_japanese_scoring_state
  VALIDATE CONSTRAINT game_japanese_scoring_game_rules_fk;
ALTER TABLE game_japanese_resume_authorizations
  VALIDATE CONSTRAINT game_japanese_resume_authorizations_game_rules_fk;
ALTER TABLE game_scoring_resume_events
  VALIDATE CONSTRAINT game_scoring_resume_events_game_rules_fk;

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_rating_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE matchmaking_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_scoring_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_dead_stones ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_scoring_resume_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_japanese_resume_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_japanese_scoring_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_japanese_dead_stones ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_japanese_neutral_region_seeds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON game_scoring_resume_events FROM PUBLIC;
REVOKE ALL ON game_japanese_resume_authorizations FROM PUBLIC;
REVOKE ALL ON player_blocks FROM PUBLIC;
REVOKE ALL ON player_reports FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON schema_migrations, users, games, moves, player_stats, player_rating_history,
      matchmaking_queue, user_sessions, guest_sessions, auth_rate_limits, game_messages,
      player_blocks, player_reports,
      game_scoring_state, game_dead_stones, game_scoring_resume_events,
      game_japanese_resume_authorizations, game_japanese_scoring_state,
      game_japanese_dead_stones, game_japanese_neutral_region_seeds FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON schema_migrations, users, games, moves, player_stats, player_rating_history,
      matchmaking_queue, user_sessions, guest_sessions, auth_rate_limits, game_messages,
      player_blocks, player_reports,
      game_scoring_state, game_dead_stones, game_scoring_resume_events,
      game_japanese_resume_authorizations, game_japanese_scoring_state,
      game_japanese_dead_stones, game_japanese_neutral_region_seeds FROM authenticated;
  END IF;
END
$$;

-- Bound direct pooled reads as well as transactional mutations without
-- changing other roles or databases in the PostgreSQL cluster.
DO $gostone_statement_timeout$
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'GoStone migrations require the authenticated database role.';
  END IF;

  EXECUTE pg_catalog.format(
    'ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L',
    current_user,
    current_database(),
    '8s'
  );

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_db_role_setting AS setting
      JOIN pg_catalog.pg_database AS database ON database.oid = setting.setdatabase
      JOIN pg_catalog.pg_roles AS role ON role.oid = setting.setrole
     WHERE database.datname = current_database()
       AND role.rolname = current_user
       AND 'statement_timeout=8s' = ANY(setting.setconfig)
  ) THEN
    RAISE EXCEPTION 'The GoStone database statement timeout could not be verified.';
  END IF;
END
$gostone_statement_timeout$;

CREATE TABLE IF NOT EXISTS game_analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_version INT NOT NULL CHECK (game_version > 0),
  requested_by_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  input JSONB NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  result JSONB CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  error_code TEXT,
  error_message TEXT,
  worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT game_analysis_jobs_game_version_unique UNIQUE (game_id, game_version),
  CONSTRAINT game_analysis_jobs_result_shape_check CHECK (
    (status = 'completed' AND result IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status <> 'completed' AND result IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_game_analysis_jobs_claim
  ON game_analysis_jobs(status, created_at, id)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_game_analysis_jobs_game
  ON game_analysis_jobs(game_id, game_version DESC);

ALTER TABLE game_analysis_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game_analysis_jobs FROM PUBLIC;

DO $gostone_analysis_access$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON game_analysis_jobs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON game_analysis_jobs FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON game_analysis_jobs TO gostone_app;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'game_analysis_jobs'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON game_analysis_jobs
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END
$gostone_analysis_access$;

CREATE TABLE IF NOT EXISTS katago_workers (
  worker_id TEXT PRIMARY KEY,
  capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  engine_version TEXT NOT NULL,
  model_name TEXT NOT NULL,
  ready BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (cardinality(capabilities) > 0)
);

CREATE TABLE IF NOT EXISTS game_bots (
  game_id UUID PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  bot_player_key TEXT UNIQUE NOT NULL CHECK (bot_player_key LIKE 'bot:%'),
  display_name TEXT NOT NULL CHECK (
    char_length(display_name) BETWEEN 2 AND 40
    AND display_name = BTRIM(display_name)
  ),
  color TEXT NOT NULL CHECK (color IN ('black', 'white')),
  target_rating INT NOT NULL CHECK (target_rating BETWEEN 100 AND 3000),
  visits_per_turn INT NOT NULL CHECK (visits_per_turn BETWEEN 1 AND 2000),
  candidate_limit INT NOT NULL CHECK (candidate_limit BETWEEN 1 AND 12),
  temperature DOUBLE PRECISION NOT NULL CHECK (temperature BETWEEN 0.05 AND 3),
  scheduled_game_version INT NOT NULL DEFAULT -1 CHECK (scheduled_game_version >= -1),
  next_move_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  failure_count INT NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 1000),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_katago_workers_ready
  ON katago_workers(last_seen_at DESC)
  WHERE ready;
CREATE INDEX IF NOT EXISTS idx_game_bots_claim
  ON game_bots(next_move_at, game_id)
  WHERE lease_expires_at IS NULL;

ALTER TABLE katago_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_bots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katago_workers, game_bots FROM PUBLIC;

DO $gostone_bot_access$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON katago_workers, game_bots FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON katago_workers, game_bots FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON katago_workers, game_bots TO gostone_app;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'katago_workers'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON katago_workers
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'game_bots'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON game_bots
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END
$gostone_bot_access$;
CREATE TABLE IF NOT EXISTS puzzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'practice')),
  daily_date DATE,
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  to_play TEXT NOT NULL CHECK (to_play IN ('black', 'white')),
  position_moves JSONB NOT NULL CHECK (jsonb_typeof(position_moves) = 'array'),
  board JSONB NOT NULL CHECK (jsonb_typeof(board) = 'array'),
  solution_move TEXT NOT NULL CHECK (char_length(solution_move) BETWEEN 2 AND 4),
  solution_x INT NOT NULL,
  solution_y INT NOT NULL,
  alternatives JSONB NOT NULL CHECK (jsonb_typeof(alternatives) = 'array'),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  explanation JSONB NOT NULL CHECK (
    jsonb_typeof(explanation) = 'object'
    AND explanation ? 'en'
    AND explanation ? 'de'
  ),
  engine_version TEXT NOT NULL,
  model_name TEXT NOT NULL,
  visits INT NOT NULL CHECK (visits BETWEEN 1 AND 10000),
  source_game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  source_move_number INT CHECK (source_move_number IS NULL OR source_move_number >= 0),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT puzzles_daily_shape_check CHECK (
    (kind = 'daily' AND daily_date IS NOT NULL)
    OR (kind = 'practice' AND daily_date IS NULL)
  ),
  CONSTRAINT puzzles_solution_bounds_check CHECK (
    solution_x >= 0 AND solution_x < board_size
    AND solution_y >= 0 AND solution_y < board_size
  )
);

CREATE TABLE IF NOT EXISTS puzzle_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'practice')),
  target_date DATE,
  board_size INT NOT NULL CHECK (board_size IN (9, 13, 19)),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  puzzle_id UUID REFERENCES puzzles(id) ON DELETE SET NULL,
  worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT puzzle_generation_jobs_target_shape_check CHECK (
    (kind = 'daily' AND target_date IS NOT NULL)
    OR (kind = 'practice' AND target_date IS NULL)
  ),
  CONSTRAINT puzzle_generation_jobs_result_shape_check CHECK (
    (status = 'completed' AND puzzle_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND puzzle_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS puzzle_attempts (
  puzzle_id UUID NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL CHECK (
    char_length(player_key) BETWEEN 6 AND 128
    AND (player_key LIKE 'guest:%' OR player_key LIKE 'user:%')
  ),
  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 1000),
  solved BOOLEAN NOT NULL DEFAULT false,
  first_attempt_correct BOOLEAN,
  selected_x INT,
  selected_y INT,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  solved_at TIMESTAMPTZ,
  PRIMARY KEY (puzzle_id, player_key),
  CONSTRAINT puzzle_attempts_selection_shape_check CHECK (
    (attempt_count = 0 AND selected_x IS NULL AND selected_y IS NULL)
    OR (attempt_count > 0 AND selected_x IS NOT NULL AND selected_y IS NOT NULL)
  ),
  CONSTRAINT puzzle_attempts_solved_shape_check CHECK (
    (solved AND solved_at IS NOT NULL)
    OR (NOT solved AND solved_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_puzzles_daily_date
  ON puzzles(daily_date)
  WHERE kind = 'daily';
CREATE INDEX IF NOT EXISTS idx_puzzles_practice_published
  ON puzzles(published_at DESC, id)
  WHERE kind = 'practice';
CREATE UNIQUE INDEX IF NOT EXISTS idx_puzzle_jobs_daily_target
  ON puzzle_generation_jobs(target_date)
  WHERE kind = 'daily';
CREATE INDEX IF NOT EXISTS idx_puzzle_generation_jobs_claim
  ON puzzle_generation_jobs(status, created_at, id)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_puzzle_attempts_player
  ON puzzle_attempts(player_key, last_attempt_at DESC);

ALTER TABLE puzzles ENABLE ROW LEVEL SECURITY;
ALTER TABLE puzzle_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE puzzle_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON puzzles, puzzle_generation_jobs, puzzle_attempts FROM PUBLIC;

DO $gostone_puzzle_access$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON puzzles, puzzle_generation_jobs, puzzle_attempts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON puzzles, puzzle_generation_jobs, puzzle_attempts FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON puzzles, puzzle_generation_jobs, puzzle_attempts TO gostone_app;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'puzzles'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON puzzles
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'puzzle_generation_jobs'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON puzzle_generation_jobs
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'puzzle_attempts'
         AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON puzzle_attempts
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END
$gostone_puzzle_access$;

ALTER TABLE puzzles
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS rank_kyu INT,
  ADD COLUMN IF NOT EXISTS collection_order INT,
  ADD COLUMN IF NOT EXISTS variation JSONB;

ALTER TABLE puzzles
  DROP CONSTRAINT IF EXISTS puzzles_category_shape_check;
ALTER TABLE puzzles
  ADD CONSTRAINT puzzles_category_shape_check CHECK (
    (category IS NULL AND rank_kyu IS NULL AND collection_order IS NULL AND variation IS NULL)
    OR (
      kind = 'practice'
      AND category IN ('life_and_death', 'tesuji', 'capturing_race', 'endgame')
      AND rank_kyu BETWEEN 1 AND 30
      AND collection_order BETWEEN 1 AND 10
      AND jsonb_typeof(variation) = 'object'
      AND variation ? 'version'
      AND variation ? 'mainLine'
      AND variation ? 'refutations'
    )
  );

ALTER TABLE puzzle_generation_jobs
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS rank_kyu INT,
  ADD COLUMN IF NOT EXISTS collection_order INT;

ALTER TABLE puzzle_generation_jobs
  DROP CONSTRAINT IF EXISTS puzzle_generation_jobs_category_shape_check;
ALTER TABLE puzzle_generation_jobs
  ADD CONSTRAINT puzzle_generation_jobs_category_shape_check CHECK (
    (category IS NULL AND rank_kyu IS NULL AND collection_order IS NULL)
    OR (
      kind = 'practice'
      AND target_date IS NULL
      AND category IN ('life_and_death', 'tesuji', 'capturing_race', 'endgame')
      AND rank_kyu BETWEEN 1 AND 30
      AND collection_order BETWEEN 1 AND 10
    )
  );

ALTER TABLE puzzle_attempts
  ADD COLUMN IF NOT EXISTS variation_progress JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS variation_revision INT NOT NULL DEFAULT 0;

ALTER TABLE puzzle_attempts
  DROP CONSTRAINT IF EXISTS puzzle_attempts_variation_progress_check;
ALTER TABLE puzzle_attempts
  ADD CONSTRAINT puzzle_attempts_variation_progress_check CHECK (
    jsonb_typeof(variation_progress) = 'array'
    AND jsonb_array_length(variation_progress) <= 12
    AND variation_revision BETWEEN 0 AND 1000
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_puzzles_category_order
  ON puzzles(category, collection_order)
  WHERE kind = 'practice' AND category IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_puzzle_jobs_category_order
  ON puzzle_generation_jobs(category, collection_order)
  WHERE kind = 'practice' AND category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_puzzles_category_catalog
  ON puzzles(category, collection_order, id)
  WHERE kind = 'practice' AND category IS NOT NULL;

-- The former practice inventory was generated from four rotated templates.
-- Remove only that generated catalog so the worker can recreate it from the
-- 40 licensed, distinct source positions. Daily puzzles and player games stay intact.
DELETE FROM puzzle_attempts
 WHERE puzzle_id IN (
   SELECT id FROM puzzles WHERE kind = 'practice' AND category IS NOT NULL
 );

DELETE FROM puzzle_generation_jobs
 WHERE kind = 'practice' AND category IS NOT NULL;

DELETE FROM puzzles
 WHERE kind = 'practice' AND category IS NOT NULL;

-- Close the deployment race in which an older worker can recreate a 9x9
-- template job between the catalog reset and the new worker rollout.
DELETE FROM puzzle_attempts
 WHERE puzzle_id IN (
   SELECT id FROM puzzles WHERE kind = 'practice' AND category IS NOT NULL
 );

DELETE FROM puzzle_generation_jobs
 WHERE kind = 'practice' AND category IS NOT NULL;

DELETE FROM puzzles
 WHERE kind = 'practice' AND category IS NOT NULL;

ALTER TABLE puzzles
  DROP CONSTRAINT IF EXISTS puzzles_category_shape_check;
ALTER TABLE puzzles
  ADD CONSTRAINT puzzles_category_shape_check CHECK (
    (category IS NULL AND rank_kyu IS NULL AND collection_order IS NULL AND variation IS NULL)
    OR (
      kind = 'practice'
      AND board_size = 13
      AND category IN ('life_and_death', 'tesuji', 'capturing_race', 'endgame')
      AND rank_kyu BETWEEN 1 AND 30
      AND collection_order BETWEEN 1 AND 10
      AND jsonb_typeof(variation) = 'object'
      AND variation ? 'version'
      AND variation ? 'mainLine'
      AND variation ? 'refutations'
    )
  );

ALTER TABLE puzzle_generation_jobs
  DROP CONSTRAINT IF EXISTS puzzle_generation_jobs_category_shape_check;
ALTER TABLE puzzle_generation_jobs
  ADD CONSTRAINT puzzle_generation_jobs_category_shape_check CHECK (
    (category IS NULL AND rank_kyu IS NULL AND collection_order IS NULL)
    OR (
      kind = 'practice'
      AND target_date IS NULL
      AND board_size = 13
      AND category IN ('life_and_death', 'tesuji', 'capturing_race', 'endgame')
      AND rank_kyu BETWEEN 1 AND 30
      AND collection_order BETWEEN 1 AND 10
    )
  );
-- Migration 024 parity: activate Japanese scoring persistence after the
-- bootstrap's rollout-safe dormant foundation.
-- Activate the exact Japanese rules tuple and persist deadline, proposal, and
-- terminal evidence without retaining provider payloads.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_rules_profile_check;
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_scoring_method_check;
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_rules_check;
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_finish_reason_check;
ALTER TABLE matchmaking_queue
  DROP CONSTRAINT IF EXISTS matchmaking_queue_rules_profile_compatibility_check;

ALTER TABLE games
  ADD CONSTRAINT games_rules_profile_check CHECK (
    rules_profile IN (
      'legacy-immediate-area',
      'chinese-2002-gostone-v1',
      'japanese-1989-gostone-v1'
    )
  ),
  ADD CONSTRAINT games_scoring_method_check
    CHECK (scoring_method IN ('area', 'territory')),
  ADD CONSTRAINT games_rules_check CHECK (rules IN ('chinese', 'japanese')),
  ADD CONSTRAINT games_finish_reason_check CHECK (
    finish_reason IN (
      'score', 'resignation', 'timeout', 'legacy_score',
      'japanese_adjudication', 'japanese_no_result', 'japanese_abandonment'
    )
  );

ALTER TABLE matchmaking_queue
  ADD CONSTRAINT matchmaking_queue_rules_profile_compatibility_check CHECK (
    rules_profile IN (
      'legacy-immediate-area',
      'chinese-2002-gostone-v1',
      'japanese-1989-gostone-v1'
    )
  );

ALTER TABLE game_japanese_scoring_state
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS black_participated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS white_participated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suggestion_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS suggestion_request_identity TEXT,
  ADD COLUMN IF NOT EXISTS suggestion_provider_kind TEXT,
  ADD COLUMN IF NOT EXISTS suggestion_engine_version TEXT,
  ADD COLUMN IF NOT EXISTS suggestion_model_version TEXT,
  ADD COLUMN IF NOT EXISTS suggestion_config_version TEXT,
  ADD COLUMN IF NOT EXISTS suggestion_confidence_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS suggestion_latency_ms INT,
  ADD COLUMN IF NOT EXISTS suggestion_error_class TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM game_japanese_scoring_state WHERE expires_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Japanese scoring activation requires application-written deadlines.';
  END IF;
END
$$;

ALTER TABLE game_japanese_scoring_state
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE game_japanese_scoring_state
  DROP CONSTRAINT IF EXISTS game_japanese_scoring_deadline_check,
  DROP CONSTRAINT IF EXISTS game_japanese_scoring_participation_check,
  DROP CONSTRAINT IF EXISTS game_japanese_scoring_suggestion_check;

ALTER TABLE game_japanese_scoring_state
  ADD CONSTRAINT game_japanese_scoring_deadline_check CHECK (
    expires_at >= started_at + INTERVAL '30 seconds'
    AND expires_at <= started_at + INTERVAL '1 hour'
  ),
  ADD CONSTRAINT game_japanese_scoring_participation_check CHECK (
    (black_participated_at IS NULL OR black_participated_at BETWEEN started_at AND expires_at)
    AND (white_participated_at IS NULL OR white_participated_at BETWEEN started_at AND expires_at)
  ),
  ADD CONSTRAINT game_japanese_scoring_suggestion_check CHECK (COALESCE((
    suggestion_status IN ('pending', 'ready', 'unavailable', 'invalid', 'low_confidence')
    AND (
      (
        suggestion_status = 'pending'
        AND suggestion_request_identity IS NULL
        AND suggestion_provider_kind IS NULL
        AND suggestion_engine_version IS NULL
        AND suggestion_model_version IS NULL
        AND suggestion_config_version IS NULL
        AND suggestion_confidence_policy_version IS NULL
        AND suggestion_latency_ms IS NULL
        AND suggestion_error_class IS NULL
      )
      OR
      (
        suggestion_status IN ('ready', 'low_confidence')
        AND suggestion_request_identity ~ '^sha256:[0-9a-f]{64}$'
        AND suggestion_provider_kind IN ('hosted-http', 'local-http', 'deterministic')
        AND LENGTH(suggestion_engine_version) BETWEEN 1 AND 120
        AND LENGTH(suggestion_model_version) BETWEEN 1 AND 120
        AND LENGTH(suggestion_config_version) BETWEEN 1 AND 120
        AND LENGTH(suggestion_confidence_policy_version) BETWEEN 1 AND 120
        AND suggestion_latency_ms BETWEEN 0 AND 3600000
        AND suggestion_error_class IS NULL
      )
      OR
      (
        suggestion_status IN ('unavailable', 'invalid')
        AND suggestion_latency_ms BETWEEN 0 AND 3600000
        AND suggestion_error_class IN (
          'invalid_request', 'provider_not_configured', 'request_aborted',
          'request_timeout', 'provider_unavailable', 'provider_http_error',
          'response_too_large', 'invalid_response_json', 'invalid_response',
          'stale_response', 'model_mismatch', 'circuit_open', 'retries_exhausted'
        )
        AND (
          (
            suggestion_request_identity IS NULL
            AND suggestion_provider_kind IS NULL
            AND suggestion_engine_version IS NULL
            AND suggestion_model_version IS NULL
            AND suggestion_config_version IS NULL
            AND suggestion_confidence_policy_version IS NULL
          )
          OR
          (
            suggestion_request_identity ~ '^sha256:[0-9a-f]{64}$'
            AND suggestion_provider_kind IN ('hosted-http', 'local-http', 'deterministic')
            AND LENGTH(suggestion_engine_version) BETWEEN 1 AND 120
            AND LENGTH(suggestion_model_version) BETWEEN 1 AND 120
            AND LENGTH(suggestion_config_version) BETWEEN 1 AND 120
            AND LENGTH(suggestion_confidence_policy_version) BETWEEN 1 AND 120
          )
        )
      )
    )
  ), FALSE));

CREATE TABLE IF NOT EXISTS game_japanese_scoring_proposals (
  game_id UUID NOT NULL,
  scoring_revision INT NOT NULL CHECK (scoring_revision > 0),
  proposal_hash TEXT NOT NULL CHECK (proposal_hash ~ '^[0-9a-f]{64}$'),
  source TEXT NOT NULL CHECK (source IN ('katago_initial', 'player_edit', 'undo', 'reset')),
  actor_color TEXT CHECK (actor_color IN ('black', 'white')),
  parent_scoring_revision INT,
  dead_stones JSONB NOT NULL CHECK (jsonb_typeof(dead_stones) = 'array'),
  neutral_region_seeds JSONB NOT NULL
    CHECK (jsonb_typeof(neutral_region_seeds) = 'array'),
  stopped_move_number INT NOT NULL CHECK (stopped_move_number >= 2),
  stopped_board_hash TEXT NOT NULL CHECK (LENGTH(stopped_board_hash) > 0),
  rules TEXT NOT NULL CHECK (rules = 'japanese'),
  rules_profile TEXT NOT NULL CHECK (rules_profile = 'japanese-1989-gostone-v1'),
  scoring_method TEXT NOT NULL CHECK (scoring_method = 'territory'),
  komi NUMERIC(4,1) NOT NULL CHECK (komi = 6.5),
  handicap INT NOT NULL CHECK (handicap = 0),
  suggestion_request_identity TEXT,
  suggestion_provider_kind TEXT,
  suggestion_engine_version TEXT,
  suggestion_model_version TEXT,
  suggestion_config_version TEXT,
  suggestion_confidence_policy_version TEXT,
  suggestion_latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, scoring_revision),
  CONSTRAINT game_japanese_scoring_proposals_game_fk
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  CONSTRAINT game_japanese_scoring_proposals_parent_fk
    FOREIGN KEY (game_id, parent_scoring_revision)
    REFERENCES game_japanese_scoring_proposals(game_id, scoring_revision),
  CONSTRAINT game_japanese_scoring_proposals_game_rules_fk
    FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)
    REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)
    ON DELETE CASCADE,
  CHECK (COALESCE((
    (
      source = 'katago_initial'
      AND actor_color IS NULL
      AND parent_scoring_revision IS NULL
      AND suggestion_request_identity ~ '^sha256:[0-9a-f]{64}$'
      AND suggestion_provider_kind IN ('hosted-http', 'local-http', 'deterministic')
      AND LENGTH(suggestion_engine_version) BETWEEN 1 AND 120
      AND LENGTH(suggestion_model_version) BETWEEN 1 AND 120
      AND LENGTH(suggestion_config_version) BETWEEN 1 AND 120
      AND LENGTH(suggestion_confidence_policy_version) BETWEEN 1 AND 120
      AND suggestion_latency_ms BETWEEN 0 AND 3600000
    )
    OR
    (
      source = 'player_edit'
      AND actor_color IS NOT NULL
      AND parent_scoring_revision IS NULL
      AND suggestion_request_identity IS NULL
      AND suggestion_provider_kind IS NULL
      AND suggestion_engine_version IS NULL
      AND suggestion_model_version IS NULL
      AND suggestion_config_version IS NULL
      AND suggestion_confidence_policy_version IS NULL
      AND suggestion_latency_ms IS NULL
    )
    OR
    (
      source <> 'katago_initial'
      AND actor_color IS NOT NULL
      AND parent_scoring_revision IS NOT NULL
      AND suggestion_request_identity IS NULL
      AND suggestion_provider_kind IS NULL
      AND suggestion_engine_version IS NULL
      AND suggestion_model_version IS NULL
      AND suggestion_config_version IS NULL
      AND suggestion_confidence_policy_version IS NULL
      AND suggestion_latency_ms IS NULL
    )
  ), FALSE))
);

CREATE TABLE IF NOT EXISTS game_japanese_scoring_terminal_events (
  game_id UUID PRIMARY KEY,
  scoring_revision INT NOT NULL CHECK (scoring_revision > 0),
  proposal_hash TEXT NOT NULL CHECK (proposal_hash ~ '^[0-9a-f]{64}$'),
  stopped_move_number INT NOT NULL CHECK (stopped_move_number >= 2),
  stopped_board_hash TEXT NOT NULL CHECK (LENGTH(stopped_board_hash) > 0),
  rules TEXT NOT NULL CHECK (rules = 'japanese'),
  rules_profile TEXT NOT NULL CHECK (rules_profile = 'japanese-1989-gostone-v1'),
  scoring_method TEXT NOT NULL CHECK (scoring_method = 'territory'),
  komi NUMERIC(4,1) NOT NULL CHECK (komi = 6.5),
  handicap INT NOT NULL CHECK (handicap = 0),
  outcome_kind TEXT NOT NULL CHECK (outcome_kind IN (
    'katago_validated', 'katago_low_confidence', 'katago_unavailable',
    'no_participation', 'abandonment'
  )),
  winner_color TEXT CHECK (winner_color IN ('black', 'white')),
  abandoned_by_color TEXT CHECK (abandoned_by_color IN ('black', 'white')),
  suggestion_request_identity TEXT,
  suggestion_status TEXT,
  suggestion_provider_kind TEXT,
  suggestion_engine_version TEXT,
  suggestion_model_version TEXT,
  suggestion_config_version TEXT,
  suggestion_confidence_policy_version TEXT,
  suggestion_latency_ms INT,
  suggestion_error_class TEXT,
  adjudication_proposal_hash TEXT CHECK (
    adjudication_proposal_hash IS NULL
    OR adjudication_proposal_hash ~ '^[0-9a-f]{64}$'
  ),
  adjudication_dead_stones JSONB CHECK (
    adjudication_dead_stones IS NULL OR jsonb_typeof(adjudication_dead_stones) = 'array'
  ),
  adjudication_neutral_region_seeds JSONB CHECK (
    adjudication_neutral_region_seeds IS NULL
    OR jsonb_typeof(adjudication_neutral_region_seeds) = 'array'
  ),
  adjudication_request_identity TEXT,
  adjudication_provider_kind TEXT,
  adjudication_engine_version TEXT,
  adjudication_model_version TEXT,
  adjudication_config_version TEXT,
  adjudication_confidence_policy_version TEXT,
  adjudication_latency_ms INT,
  adjudication_error_class TEXT,
  captured_white_by_black_at_stop INT NOT NULL
    CHECK (captured_white_by_black_at_stop >= 0),
  captured_black_by_white_at_stop INT NOT NULL
    CHECK (captured_black_by_white_at_stop >= 0),
  living_black_stones INT,
  living_white_stones INT,
  black_territory INT,
  white_territory INT,
  dame_points INT,
  territory_excluded_by_agreement INT,
  dead_black_stones INT,
  dead_white_stones INT,
  black_prisoners_final INT,
  white_prisoners_final INT,
  black_total NUMERIC(6,1),
  white_total NUMERIC(6,1),
  margin NUMERIC(6,1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT game_japanese_scoring_terminal_events_game_fk
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  CONSTRAINT game_japanese_scoring_terminal_events_game_rules_fk
    FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)
    REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)
    ON DELETE CASCADE,
  CHECK (COALESCE((
    (outcome_kind = 'abandonment' AND winner_color IS NOT NULL
      AND abandoned_by_color IS NOT NULL AND winner_color <> abandoned_by_color)
    OR (outcome_kind <> 'abandonment' AND abandoned_by_color IS NULL
        AND (outcome_kind = 'katago_validated' OR winner_color IS NULL))
  ), FALSE)),
  CHECK (COALESCE((
    (
      outcome_kind LIKE 'katago_%'
      AND suggestion_status IN ('ready', 'unavailable', 'invalid', 'low_confidence')
      AND suggestion_latency_ms BETWEEN 0 AND 3600000
      AND (
        (
          suggestion_status IN ('ready', 'low_confidence')
          AND suggestion_request_identity ~ '^sha256:[0-9a-f]{64}$'
          AND suggestion_provider_kind IN ('hosted-http', 'local-http', 'deterministic')
          AND LENGTH(suggestion_engine_version) BETWEEN 1 AND 120
          AND LENGTH(suggestion_model_version) BETWEEN 1 AND 120
          AND LENGTH(suggestion_config_version) BETWEEN 1 AND 120
          AND LENGTH(suggestion_confidence_policy_version) BETWEEN 1 AND 120
          AND suggestion_error_class IS NULL
        )
        OR
        (
          suggestion_status IN ('unavailable', 'invalid')
          AND suggestion_error_class IN (
            'invalid_request', 'provider_not_configured', 'request_aborted',
            'request_timeout', 'provider_unavailable', 'provider_http_error',
            'response_too_large', 'invalid_response_json', 'invalid_response',
            'stale_response', 'model_mismatch', 'circuit_open', 'retries_exhausted'
          )
          AND (
            (
              suggestion_request_identity IS NULL
              AND suggestion_provider_kind IS NULL
              AND suggestion_engine_version IS NULL
              AND suggestion_model_version IS NULL
              AND suggestion_config_version IS NULL
              AND suggestion_confidence_policy_version IS NULL
            )
            OR
            (
              suggestion_request_identity ~ '^sha256:[0-9a-f]{64}$'
              AND suggestion_provider_kind IN ('hosted-http', 'local-http', 'deterministic')
              AND LENGTH(suggestion_engine_version) BETWEEN 1 AND 120
              AND LENGTH(suggestion_model_version) BETWEEN 1 AND 120
              AND LENGTH(suggestion_config_version) BETWEEN 1 AND 120
              AND LENGTH(suggestion_confidence_policy_version) BETWEEN 1 AND 120
            )
          )
        )
      )
    )
    OR
    (
      outcome_kind NOT LIKE 'katago_%'
      AND suggestion_request_identity IS NULL AND suggestion_status IS NULL
      AND suggestion_provider_kind IS NULL AND suggestion_engine_version IS NULL
      AND suggestion_model_version IS NULL AND suggestion_config_version IS NULL
      AND suggestion_confidence_policy_version IS NULL AND suggestion_latency_ms IS NULL
      AND suggestion_error_class IS NULL
    )
  ), FALSE)),
  CHECK (COALESCE((
    (
      outcome_kind IN ('katago_validated', 'katago_low_confidence')
      AND adjudication_proposal_hash ~ '^[0-9a-f]{64}$'
      AND jsonb_typeof(adjudication_dead_stones) = 'array'
      AND jsonb_typeof(adjudication_neutral_region_seeds) = 'array'
      AND adjudication_request_identity ~ '^sha256:[0-9a-f]{64}$'
      AND adjudication_request_identity IS DISTINCT FROM suggestion_request_identity
      AND adjudication_provider_kind IN ('hosted-http', 'local-http', 'deterministic')
      AND LENGTH(adjudication_engine_version) BETWEEN 1 AND 120
      AND LENGTH(adjudication_model_version) BETWEEN 1 AND 120
      AND LENGTH(adjudication_config_version) BETWEEN 1 AND 120
      AND LENGTH(adjudication_confidence_policy_version) BETWEEN 1 AND 120
      AND adjudication_latency_ms BETWEEN 0 AND 3600000
      AND adjudication_error_class IS NULL
    )
    OR
    (
      outcome_kind = 'katago_unavailable'
      AND adjudication_proposal_hash IS NULL
      AND adjudication_dead_stones IS NULL
      AND adjudication_neutral_region_seeds IS NULL
      AND adjudication_latency_ms BETWEEN 0 AND 3600000
      AND adjudication_error_class IN (
        'invalid_request', 'provider_not_configured', 'request_aborted',
        'request_timeout', 'provider_unavailable', 'provider_http_error',
        'response_too_large', 'invalid_response_json', 'invalid_response',
        'stale_response', 'model_mismatch', 'circuit_open', 'retries_exhausted'
      )
      AND (
        (
          adjudication_request_identity IS NULL
          AND adjudication_provider_kind IS NULL
          AND adjudication_engine_version IS NULL
          AND adjudication_model_version IS NULL
          AND adjudication_config_version IS NULL
          AND adjudication_confidence_policy_version IS NULL
        )
        OR
        (
          adjudication_request_identity ~ '^sha256:[0-9a-f]{64}$'
          AND adjudication_request_identity IS DISTINCT FROM suggestion_request_identity
          AND adjudication_provider_kind IN ('hosted-http', 'local-http', 'deterministic')
          AND LENGTH(adjudication_engine_version) BETWEEN 1 AND 120
          AND LENGTH(adjudication_model_version) BETWEEN 1 AND 120
          AND LENGTH(adjudication_config_version) BETWEEN 1 AND 120
          AND LENGTH(adjudication_confidence_policy_version) BETWEEN 1 AND 120
        )
      )
    )
    OR
    (
      outcome_kind NOT LIKE 'katago_%'
      AND adjudication_proposal_hash IS NULL
      AND adjudication_dead_stones IS NULL
      AND adjudication_neutral_region_seeds IS NULL
      AND adjudication_request_identity IS NULL
      AND adjudication_provider_kind IS NULL
      AND adjudication_engine_version IS NULL
      AND adjudication_model_version IS NULL
      AND adjudication_config_version IS NULL
      AND adjudication_confidence_policy_version IS NULL
      AND adjudication_latency_ms IS NULL
      AND adjudication_error_class IS NULL
    )
  ), FALSE)),
  CHECK (COALESCE((
    (
      outcome_kind = 'katago_validated'
      AND adjudication_request_identity ~ '^sha256:[0-9a-f]{64}$'
      AND living_black_stones >= 0 AND living_white_stones >= 0
      AND black_territory >= 0 AND white_territory >= 0 AND dame_points >= 0
      AND territory_excluded_by_agreement >= 0
      AND dead_black_stones >= 0 AND dead_white_stones >= 0
      AND black_prisoners_final >= 0 AND white_prisoners_final >= 0
      AND black_total >= 0 AND white_total >= 0 AND margin >= 0
      AND black_prisoners_final = captured_white_by_black_at_stop + dead_white_stones
      AND white_prisoners_final = captured_black_by_white_at_stop + dead_black_stones
      AND black_total = black_territory + black_prisoners_final
      AND white_total = white_territory + white_prisoners_final + komi
      AND margin = ABS(black_total - white_total)
      AND (
        (winner_color IS NULL AND black_total = white_total AND margin = 0)
        OR (winner_color = 'black' AND black_total > white_total AND margin > 0)
        OR (winner_color = 'white' AND white_total > black_total AND margin > 0)
      )
    )
    OR
    (
      outcome_kind <> 'katago_validated'
      AND living_black_stones IS NULL AND living_white_stones IS NULL
      AND black_territory IS NULL AND white_territory IS NULL AND dame_points IS NULL
      AND territory_excluded_by_agreement IS NULL
      AND dead_black_stones IS NULL AND dead_white_stones IS NULL
      AND black_prisoners_final IS NULL AND white_prisoners_final IS NULL
      AND black_total IS NULL AND white_total IS NULL AND margin IS NULL
    )
  ), FALSE))
);

CREATE OR REPLACE FUNCTION public.guard_japanese_append_only_evidence()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM public.games WHERE id = OLD.game_id;
    IF NOT FOUND THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'Japanese scoring history is append-only.' USING ERRCODE = '23514';
END
$$;

CREATE OR REPLACE FUNCTION public.validate_japanese_scoring_proposal_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD; scoring_row RECORD; previous_revision INT;
BEGIN
  SELECT * INTO game_row FROM public.games WHERE id = NEW.game_id FOR UPDATE;
  SELECT * INTO scoring_row FROM public.game_japanese_scoring_state
   WHERE game_id = NEW.game_id FOR UPDATE;
  IF game_row.id IS NULL OR NOT FOUND OR game_row.status <> 'active' OR game_row.phase <> 'scoring'
    OR game_row.scoring_revision IS DISTINCT FROM NEW.scoring_revision
    OR scoring_row.revision IS DISTINCT FROM NEW.scoring_revision
    OR scoring_row.proposal_hash IS DISTINCT FROM NEW.proposal_hash
    OR scoring_row.board_hash IS DISTINCT FROM NEW.stopped_board_hash
    OR scoring_row.stopped_move_number IS DISTINCT FROM NEW.stopped_move_number
    OR scoring_row.rules IS DISTINCT FROM NEW.rules
    OR scoring_row.rules_profile IS DISTINCT FROM NEW.rules_profile
    OR scoring_row.scoring_method IS DISTINCT FROM NEW.scoring_method
    OR scoring_row.komi IS DISTINCT FROM NEW.komi
    OR scoring_row.handicap IS DISTINCT FROM NEW.handicap
    OR scoring_row.finalized_at IS NOT NULL OR statement_timestamp() >= scoring_row.expires_at
  THEN RAISE EXCEPTION 'Proposal history must match live Japanese scoring.' USING ERRCODE = '23514';
  END IF;
  SELECT MAX(scoring_revision) INTO previous_revision
    FROM public.game_japanese_scoring_proposals
   WHERE game_id = NEW.game_id AND stopped_move_number = NEW.stopped_move_number;
  IF previous_revision IS NULL THEN
    IF NEW.source = 'katago_initial' THEN
      IF NEW.parent_scoring_revision IS NOT NULL
        OR scoring_row.suggestion_status NOT IN ('ready', 'low_confidence')
        OR NEW.suggestion_request_identity IS DISTINCT FROM scoring_row.suggestion_request_identity
        OR NEW.suggestion_provider_kind IS DISTINCT FROM scoring_row.suggestion_provider_kind
        OR NEW.suggestion_engine_version IS DISTINCT FROM scoring_row.suggestion_engine_version
        OR NEW.suggestion_model_version IS DISTINCT FROM scoring_row.suggestion_model_version
        OR NEW.suggestion_config_version IS DISTINCT FROM scoring_row.suggestion_config_version
        OR NEW.suggestion_confidence_policy_version IS DISTINCT FROM scoring_row.suggestion_confidence_policy_version
        OR NEW.suggestion_latency_ms IS DISTINCT FROM scoring_row.suggestion_latency_ms
      THEN RAISE EXCEPTION 'Initial proposal must preserve validated suggestion diagnostics.' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.source <> 'player_edit' OR NEW.parent_scoring_revision IS NOT NULL
      OR scoring_row.suggestion_status NOT IN ('unavailable', 'invalid')
    THEN RAISE EXCEPTION 'First manual proposal requires unavailable suggestion evidence.' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.source = 'katago_initial' OR NEW.scoring_revision <= previous_revision
      OR NOT EXISTS (
        SELECT 1 FROM public.game_japanese_scoring_proposals AS parent
         WHERE parent.game_id = NEW.game_id
           AND parent.scoring_revision = NEW.parent_scoring_revision
           AND parent.stopped_move_number = NEW.stopped_move_number
      )
    THEN RAISE EXCEPTION 'Proposal edits require earlier same-phase provenance.' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.created_at := statement_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_japanese_scoring_terminal_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD; scoring_row RECORD; evidence_count INT; distinct_count INT;
BEGIN
  SELECT * INTO game_row FROM public.games WHERE id = NEW.game_id FOR UPDATE;
  SELECT * INTO scoring_row FROM public.game_japanese_scoring_state
   WHERE game_id = NEW.game_id FOR UPDATE;
  IF game_row.id IS NULL OR NOT FOUND OR game_row.status <> 'active' OR game_row.phase <> 'scoring'
    OR game_row.scoring_revision IS DISTINCT FROM NEW.scoring_revision
    OR scoring_row.revision IS DISTINCT FROM NEW.scoring_revision
    OR scoring_row.proposal_hash IS DISTINCT FROM NEW.proposal_hash
    OR scoring_row.board_hash IS DISTINCT FROM NEW.stopped_board_hash
    OR scoring_row.stopped_move_number IS DISTINCT FROM NEW.stopped_move_number
    OR scoring_row.rules IS DISTINCT FROM NEW.rules
    OR scoring_row.rules_profile IS DISTINCT FROM NEW.rules_profile
    OR scoring_row.scoring_method IS DISTINCT FROM NEW.scoring_method
    OR scoring_row.komi IS DISTINCT FROM NEW.komi OR scoring_row.handicap IS DISTINCT FROM NEW.handicap
    OR scoring_row.captured_white_by_black_at_stop IS DISTINCT FROM NEW.captured_white_by_black_at_stop
    OR scoring_row.captured_black_by_white_at_stop IS DISTINCT FROM NEW.captured_black_by_white_at_stop
    OR scoring_row.finalized_at IS NOT NULL OR statement_timestamp() < scoring_row.expires_at
  THEN RAISE EXCEPTION 'Terminal evidence must match expired Japanese scoring.' USING ERRCODE = '23514';
  END IF;
  IF NEW.outcome_kind LIKE 'katago_%' THEN
    NEW.suggestion_request_identity := scoring_row.suggestion_request_identity;
    NEW.suggestion_status := scoring_row.suggestion_status;
    NEW.suggestion_provider_kind := scoring_row.suggestion_provider_kind;
    NEW.suggestion_engine_version := scoring_row.suggestion_engine_version;
    NEW.suggestion_model_version := scoring_row.suggestion_model_version;
    NEW.suggestion_config_version := scoring_row.suggestion_config_version;
    NEW.suggestion_confidence_policy_version := scoring_row.suggestion_confidence_policy_version;
    NEW.suggestion_latency_ms := scoring_row.suggestion_latency_ms;
    NEW.suggestion_error_class := scoring_row.suggestion_error_class;
  ELSE
    NEW.suggestion_request_identity := NULL;
    NEW.suggestion_status := NULL;
    NEW.suggestion_provider_kind := NULL;
    NEW.suggestion_engine_version := NULL;
    NEW.suggestion_model_version := NULL;
    NEW.suggestion_config_version := NULL;
    NEW.suggestion_confidence_policy_version := NULL;
    NEW.suggestion_latency_ms := NULL;
    NEW.suggestion_error_class := NULL;
  END IF;
  IF (NEW.outcome_kind = 'no_participation' AND (scoring_row.black_participated_at IS NOT NULL OR scoring_row.white_participated_at IS NOT NULL))
    OR (NEW.outcome_kind = 'abandonment' AND ((scoring_row.black_participated_at IS NULL) = (scoring_row.white_participated_at IS NULL)))
    OR (NEW.outcome_kind LIKE 'katago_%' AND (scoring_row.black_participated_at IS NULL OR scoring_row.white_participated_at IS NULL))
    OR (NEW.outcome_kind LIKE 'katago_%' AND scoring_row.suggestion_status = 'pending')
    OR (NEW.outcome_kind LIKE 'katago_%' AND NOT EXISTS (
      SELECT 1 FROM public.game_japanese_scoring_proposals AS proposal
       WHERE proposal.game_id = NEW.game_id
         AND proposal.scoring_revision = NEW.scoring_revision
         AND proposal.proposal_hash = NEW.proposal_hash
         AND proposal.stopped_move_number = NEW.stopped_move_number
         AND proposal.stopped_board_hash = NEW.stopped_board_hash
    ))
    OR (NEW.outcome_kind NOT LIKE 'katago_%' AND NEW.suggestion_request_identity IS NOT NULL)
    OR (NEW.outcome_kind = 'abandonment' AND NEW.abandoned_by_color IS DISTINCT FROM (CASE WHEN scoring_row.black_participated_at IS NULL THEN 'black' ELSE 'white' END))
  THEN RAISE EXCEPTION 'Terminal outcome contradicts participation or suggestion evidence.' USING ERRCODE = '23514';
  END IF;
  IF NEW.outcome_kind IN ('katago_validated', 'katago_low_confidence') THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.adjudication_dead_stones) AS evidence(point)
       WHERE jsonb_typeof(evidence.point) <> 'object'
          OR NOT (evidence.point ?& ARRAY['x', 'y', 'color'])
          OR jsonb_object_length(evidence.point) <> 3
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.adjudication_neutral_region_seeds) AS evidence(point)
       WHERE jsonb_typeof(evidence.point) <> 'object'
          OR NOT (evidence.point ?& ARRAY['x', 'y'])
          OR jsonb_object_length(evidence.point) <> 2
    ) THEN
      RAISE EXCEPTION 'Deadline adjudication coordinates require exact bounded evidence objects.' USING ERRCODE = '23514';
    END IF;
    SELECT COUNT(*), COUNT(DISTINCT (point.x, point.y)) INTO evidence_count, distinct_count
      FROM jsonb_to_recordset(NEW.adjudication_dead_stones) AS point(x INT, y INT, color TEXT)
     WHERE point.x BETWEEN 0 AND game_row.board_size - 1
       AND point.y BETWEEN 0 AND game_row.board_size - 1
       AND point.color IN ('black', 'white');
    IF evidence_count <> jsonb_array_length(NEW.adjudication_dead_stones)
      OR distinct_count <> evidence_count
    THEN RAISE EXCEPTION 'Deadline adjudication dead stones must be unique occupied-board coordinates.' USING ERRCODE = '23514';
    END IF;
    SELECT COUNT(*), COUNT(DISTINCT (point.x, point.y)) INTO evidence_count, distinct_count
      FROM jsonb_to_recordset(NEW.adjudication_neutral_region_seeds) AS point(x INT, y INT)
     WHERE point.x BETWEEN 0 AND game_row.board_size - 1
       AND point.y BETWEEN 0 AND game_row.board_size - 1;
    IF evidence_count <> jsonb_array_length(NEW.adjudication_neutral_region_seeds)
      OR distinct_count <> evidence_count
    THEN RAISE EXCEPTION 'Deadline adjudication neutral seeds must be unique bounded coordinates.' USING ERRCODE = '23514';
    END IF;
    IF NEW.outcome_kind = 'katago_validated' AND (
      NEW.dead_black_stones IS DISTINCT FROM (
        SELECT COUNT(*) FROM jsonb_to_recordset(NEW.adjudication_dead_stones) AS point(color TEXT)
         WHERE point.color = 'black'
      ) OR NEW.dead_white_stones IS DISTINCT FROM (
        SELECT COUNT(*) FROM jsonb_to_recordset(NEW.adjudication_dead_stones) AS point(color TEXT)
         WHERE point.color = 'white'
      )
    ) THEN RAISE EXCEPTION 'Validated score counts must match deadline adjudication evidence.' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.created_at := statement_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_japanese_scoring_terminal_commit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD;
BEGIN
  SELECT game.*, EXISTS (SELECT 1 FROM public.game_japanese_scoring_state AS scoring WHERE scoring.game_id = game.id) AS has_state
    INTO game_row FROM public.games AS game WHERE game.id = NEW.game_id;
  IF NOT FOUND OR game_row.status <> 'finished' OR game_row.phase <> 'play'
    OR game_row.to_move IS NOT NULL OR game_row.has_state
    OR game_row.scoring_revision IS DISTINCT FROM NEW.scoring_revision
    OR game_row.finish_reason IS DISTINCT FROM (CASE NEW.outcome_kind
      WHEN 'abandonment' THEN 'japanese_abandonment'
      WHEN 'katago_validated' THEN 'japanese_adjudication'
      ELSE 'japanese_no_result' END)
    OR game_row.winner_key IS DISTINCT FROM (CASE NEW.winner_color
      WHEN 'black' THEN game_row.black_player_key
      WHEN 'white' THEN game_row.white_player_key ELSE NULL END)
  THEN RAISE EXCEPTION 'Terminal evidence requires the matching completed game transition.' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_japanese_resume_authorization_window()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE scoring_row RECORD;
BEGIN
  PERFORM 1 FROM public.games WHERE id = NEW.game_id FOR UPDATE;
  SELECT scoring.expires_at, scoring.suggestion_status INTO scoring_row
    FROM public.game_japanese_scoring_state AS scoring
   WHERE scoring.game_id = NEW.game_id FOR UPDATE;
  IF NOT FOUND OR statement_timestamp() >= scoring_row.expires_at
    OR scoring_row.suggestion_status = 'pending'
  THEN RAISE EXCEPTION 'Japanese scoring may resume only after suggestion resolution and before its deadline.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

-- Supersede the deletion path from migration 023 so a deadline event may
-- close even a once-confirmed scoring row without weakening agreement writes.
CREATE OR REPLACE FUNCTION public.guard_japanese_scoring_state_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE proposal_inputs_changed BOOLEAN; initial_suggestion_change BOOLEAN; initial_suggestion_failure BOOLEAN; authorized_close BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.games AS game
      LEFT JOIN public.game_japanese_resume_authorizations AS resume_authorization
        ON resume_authorization.game_id = game.id
       AND resume_authorization.scoring_revision = OLD.revision
       AND resume_authorization.stopped_move_number = OLD.stopped_move_number
       AND resume_authorization.stopped_board_hash = OLD.board_hash
      LEFT JOIN public.game_japanese_scoring_terminal_events AS terminal
        ON terminal.game_id = game.id AND terminal.scoring_revision = OLD.revision
       AND terminal.proposal_hash = OLD.proposal_hash
       AND terminal.stopped_move_number = OLD.stopped_move_number
       AND terminal.stopped_board_hash = OLD.board_hash
     WHERE game.id = OLD.game_id AND (
       (resume_authorization.game_id IS NOT NULL
        AND game.status = 'active' AND game.phase = 'play' AND game.consecutive_passes = 0
        AND game.scoring_revision = OLD.revision + 1
        AND resume_authorization.rules = OLD.rules
        AND resume_authorization.rules_profile = OLD.rules_profile
        AND resume_authorization.scoring_method = OLD.scoring_method
        AND resume_authorization.komi = OLD.komi
        AND resume_authorization.handicap = OLD.handicap
        AND game.to_move = CASE resume_authorization.requested_by_color WHEN 'black' THEN 'white' ELSE 'black' END)
       OR (game.status = 'finished' AND game.phase = 'play' AND game.to_move IS NULL
           AND game.scoring_revision = OLD.revision
           AND (
             terminal.game_id IS NOT NULL
             OR (
               game.finish_reason IN ('resignation', 'timeout')
               AND game.rules = OLD.rules AND game.rules_profile = OLD.rules_profile
               AND game.scoring_method = OLD.scoring_method AND game.komi = OLD.komi
               AND game.handicap = OLD.handicap
             )
           ))
     )
    ) INTO authorized_close;
    IF authorized_close THEN RETURN OLD; END IF;
    PERFORM 1 FROM public.games WHERE id = OLD.game_id;
    IF FOUND THEN
      IF OLD.finalized_at IS NOT NULL OR OLD.black_confirmed_revision IS NOT NULL OR OLD.white_confirmed_revision IS NOT NULL
      THEN RAISE EXCEPTION 'Confirmed Japanese scoring state is immutable.' USING ERRCODE = '23514'; END IF;
      RAISE EXCEPTION 'Japanese scoring state requires exact resume or terminal evidence.' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.finalized_at IS NOT NULL AND NEW IS DISTINCT FROM OLD
  THEN RAISE EXCEPTION 'Finalized Japanese scoring state is immutable.' USING ERRCODE = '23514'; END IF;
  IF NEW.game_id IS DISTINCT FROM OLD.game_id OR NEW.board_hash IS DISTINCT FROM OLD.board_hash
    OR NEW.stopped_move_number IS DISTINCT FROM OLD.stopped_move_number
    OR NEW.rules IS DISTINCT FROM OLD.rules OR NEW.rules_profile IS DISTINCT FROM OLD.rules_profile
    OR NEW.scoring_method IS DISTINCT FROM OLD.scoring_method OR NEW.komi IS DISTINCT FROM OLD.komi
    OR NEW.handicap IS DISTINCT FROM OLD.handicap OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.started_at IS DISTINCT FROM OLD.started_at
    OR NEW.captured_white_by_black_at_stop IS DISTINCT FROM OLD.captured_white_by_black_at_stop
    OR NEW.captured_black_by_white_at_stop IS DISTINCT FROM OLD.captured_black_by_white_at_stop
  THEN RAISE EXCEPTION 'Japanese scoring phase identity is immutable.' USING ERRCODE = '23514'; END IF;
  IF statement_timestamp() >= OLD.expires_at
  THEN RAISE EXCEPTION 'Expired Japanese scoring state may be closed only by deadline resolution.' USING ERRCODE = '23514'; END IF;
  initial_suggestion_change := OLD.suggestion_status = 'pending'
    AND NEW.suggestion_status IN ('ready', 'low_confidence')
    AND NEW.revision = OLD.revision
    AND NEW.proposal_hash IS DISTINCT FROM OLD.proposal_hash
    AND OLD.black_confirmed_revision IS NULL AND OLD.white_confirmed_revision IS NULL
    AND NEW.black_confirmed_revision IS NULL AND NEW.white_confirmed_revision IS NULL
    AND NEW.black_participated_at IS NOT DISTINCT FROM OLD.black_participated_at
    AND NEW.white_participated_at IS NOT DISTINCT FROM OLD.white_participated_at
    AND EXISTS (SELECT 1 FROM public.games AS game WHERE game.id = OLD.game_id AND game.scoring_revision = NEW.revision);
  initial_suggestion_failure := OLD.suggestion_status = 'pending'
    AND NEW.suggestion_status IN ('unavailable', 'invalid')
    AND NEW.revision = OLD.revision
    AND NEW.proposal_hash IS NOT DISTINCT FROM OLD.proposal_hash
    AND OLD.black_confirmed_revision IS NULL AND OLD.white_confirmed_revision IS NULL
    AND NEW.black_confirmed_revision IS NULL AND NEW.white_confirmed_revision IS NULL
    AND NEW.black_participated_at IS NOT DISTINCT FROM OLD.black_participated_at
    AND NEW.white_participated_at IS NOT DISTINCT FROM OLD.white_participated_at;
  IF OLD.suggestion_status = 'pending'
    AND NOT initial_suggestion_change AND NOT initial_suggestion_failure
  THEN RAISE EXCEPTION 'Pending Japanese scoring does not accept player mutation.' USING ERRCODE = '23514'; END IF;
  IF (OLD.black_participated_at IS NOT NULL AND NEW.black_participated_at IS DISTINCT FROM OLD.black_participated_at)
    OR (OLD.white_participated_at IS NOT NULL AND NEW.white_participated_at IS DISTINCT FROM OLD.white_participated_at)
  THEN RAISE EXCEPTION 'Japanese participation evidence is monotonic.' USING ERRCODE = '23514'; END IF;
  IF OLD.suggestion_status <> 'pending' AND (
    NEW.suggestion_status IS DISTINCT FROM OLD.suggestion_status
    OR NEW.suggestion_request_identity IS DISTINCT FROM OLD.suggestion_request_identity
    OR NEW.suggestion_provider_kind IS DISTINCT FROM OLD.suggestion_provider_kind
    OR NEW.suggestion_engine_version IS DISTINCT FROM OLD.suggestion_engine_version
    OR NEW.suggestion_model_version IS DISTINCT FROM OLD.suggestion_model_version
    OR NEW.suggestion_config_version IS DISTINCT FROM OLD.suggestion_config_version
    OR NEW.suggestion_confidence_policy_version IS DISTINCT FROM OLD.suggestion_confidence_policy_version
    OR NEW.suggestion_latency_ms IS DISTINCT FROM OLD.suggestion_latency_ms
    OR NEW.suggestion_error_class IS DISTINCT FROM OLD.suggestion_error_class)
  THEN RAISE EXCEPTION 'Japanese suggestion diagnostics are immutable.' USING ERRCODE = '23514'; END IF;
  proposal_inputs_changed := NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.proposal_hash IS DISTINCT FROM OLD.proposal_hash;
  IF proposal_inputs_changed AND NOT initial_suggestion_change AND (
    NEW.revision IS DISTINCT FROM OLD.revision + 1 OR NEW.proposal_hash IS NOT DISTINCT FROM OLD.proposal_hash
    OR OLD.black_confirmed_revision IS NOT NULL OR OLD.white_confirmed_revision IS NOT NULL
    OR NEW.black_confirmed_revision IS NOT NULL OR NEW.white_confirmed_revision IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM public.games AS game WHERE game.id = OLD.game_id AND game.scoring_revision = NEW.revision)
  ) THEN RAISE EXCEPTION 'Proposal edits require the next game scoring revision and cleared confirmations.' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_japanese_scoring_state_proposal_commit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.suggestion_status NOT IN ('ready', 'low_confidence')
    AND (
      TG_OP = 'INSERT'
      OR (
        NEW.revision IS NOT DISTINCT FROM OLD.revision
        AND NEW.proposal_hash IS NOT DISTINCT FROM OLD.proposal_hash
      )
    )
  THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.game_japanese_scoring_proposals AS proposal
     WHERE proposal.game_id = NEW.game_id AND proposal.scoring_revision = NEW.revision
       AND proposal.proposal_hash = NEW.proposal_hash
       AND proposal.stopped_move_number = NEW.stopped_move_number
       AND proposal.stopped_board_hash = NEW.board_hash
  ) THEN RAISE EXCEPTION 'Current Japanese proposal requires append-only history.' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.guard_japanese_append_only_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_japanese_scoring_proposal_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_japanese_scoring_terminal_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_japanese_scoring_terminal_commit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_japanese_resume_authorization_window() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_japanese_scoring_state_proposal_commit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_japanese_scoring_state_mutation() FROM PUBLIC;

DROP TRIGGER IF EXISTS game_japanese_scoring_state_mutation_guard ON game_japanese_scoring_state;
DROP TRIGGER IF EXISTS game_japanese_scoring_state_proposal_commit_guard ON game_japanese_scoring_state;
DROP TRIGGER IF EXISTS game_japanese_scoring_proposals_insert_guard ON game_japanese_scoring_proposals;
DROP TRIGGER IF EXISTS game_japanese_scoring_proposals_immutable_guard ON game_japanese_scoring_proposals;
DROP TRIGGER IF EXISTS game_japanese_scoring_proposals_truncate_guard ON game_japanese_scoring_proposals;
DROP TRIGGER IF EXISTS game_japanese_scoring_terminal_insert_guard ON game_japanese_scoring_terminal_events;
DROP TRIGGER IF EXISTS game_japanese_scoring_terminal_commit_guard ON game_japanese_scoring_terminal_events;
DROP TRIGGER IF EXISTS game_japanese_scoring_terminal_immutable_guard ON game_japanese_scoring_terminal_events;
DROP TRIGGER IF EXISTS game_japanese_scoring_terminal_truncate_guard ON game_japanese_scoring_terminal_events;
DROP TRIGGER IF EXISTS game_japanese_resume_authorization_window_guard ON game_japanese_resume_authorizations;
CREATE TRIGGER game_japanese_resume_authorization_window_guard
  BEFORE INSERT ON game_japanese_resume_authorizations FOR EACH ROW
  EXECUTE FUNCTION public.guard_japanese_resume_authorization_window();
CREATE TRIGGER game_japanese_scoring_state_mutation_guard
  BEFORE UPDATE OR DELETE ON game_japanese_scoring_state FOR EACH ROW
  EXECUTE FUNCTION public.guard_japanese_scoring_state_mutation();
CREATE CONSTRAINT TRIGGER game_japanese_scoring_state_proposal_commit_guard
  AFTER INSERT OR UPDATE ON game_japanese_scoring_state DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_japanese_scoring_state_proposal_commit();
CREATE TRIGGER game_japanese_scoring_proposals_insert_guard
  BEFORE INSERT ON game_japanese_scoring_proposals FOR EACH ROW
  EXECUTE FUNCTION public.validate_japanese_scoring_proposal_insert();
CREATE TRIGGER game_japanese_scoring_proposals_immutable_guard
  BEFORE UPDATE OR DELETE ON game_japanese_scoring_proposals FOR EACH ROW
  EXECUTE FUNCTION public.guard_japanese_append_only_evidence();
CREATE TRIGGER game_japanese_scoring_proposals_truncate_guard
  BEFORE TRUNCATE ON game_japanese_scoring_proposals FOR EACH STATEMENT
  EXECUTE FUNCTION public.guard_japanese_append_only_evidence();
CREATE TRIGGER game_japanese_scoring_terminal_insert_guard
  BEFORE INSERT ON game_japanese_scoring_terminal_events FOR EACH ROW
  EXECUTE FUNCTION public.validate_japanese_scoring_terminal_insert();
CREATE CONSTRAINT TRIGGER game_japanese_scoring_terminal_commit_guard
  AFTER INSERT ON game_japanese_scoring_terminal_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_japanese_scoring_terminal_commit();
CREATE TRIGGER game_japanese_scoring_terminal_immutable_guard
  BEFORE UPDATE OR DELETE ON game_japanese_scoring_terminal_events FOR EACH ROW
  EXECUTE FUNCTION public.guard_japanese_append_only_evidence();
CREATE TRIGGER game_japanese_scoring_terminal_truncate_guard
  BEFORE TRUNCATE ON game_japanese_scoring_terminal_events FOR EACH STATEMENT
  EXECUTE FUNCTION public.guard_japanese_append_only_evidence();

ALTER TABLE game_japanese_scoring_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_japanese_scoring_terminal_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game_japanese_scoring_proposals FROM PUBLIC;
REVOKE ALL ON game_japanese_scoring_terminal_events FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON game_japanese_scoring_proposals, game_japanese_scoring_terminal_events FROM anon;
    REVOKE ALL ON FUNCTION public.guard_japanese_append_only_evidence(),
      public.validate_japanese_scoring_proposal_insert(),
      public.validate_japanese_scoring_terminal_insert(),
      public.validate_japanese_scoring_terminal_commit(),
      public.guard_japanese_resume_authorization_window(),
      public.validate_japanese_scoring_state_proposal_commit(),
      public.guard_japanese_scoring_state_mutation() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON game_japanese_scoring_proposals, game_japanese_scoring_terminal_events FROM authenticated;
    REVOKE ALL ON FUNCTION public.guard_japanese_append_only_evidence(),
      public.validate_japanese_scoring_proposal_insert(),
      public.validate_japanese_scoring_terminal_insert(),
      public.validate_japanese_scoring_terminal_commit(),
      public.guard_japanese_resume_authorization_window(),
      public.validate_japanese_scoring_state_proposal_commit(),
      public.guard_japanese_scoring_state_mutation() FROM authenticated;
  END IF;
END
$$;

-- Migration 025 is last in the bootstrap order; retain its terminal reason
-- after the activation section above has recreated this named constraint.
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_finish_reason_check;
ALTER TABLE games
  ADD CONSTRAINT games_finish_reason_check CHECK (
    finish_reason IN (
      'score', 'resignation', 'timeout', 'legacy_score',
      'japanese_adjudication', 'japanese_no_result', 'japanese_abandonment',
      'japanese_repetition'
    )
  );
-- Activate one global Glicko-2 state per registered account. Existing
-- per-board fixed-update rows remain readable and are labeled honestly.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE player_rating_history
  ADD COLUMN IF NOT EXISTS rating_algorithm_version TEXT;

UPDATE player_rating_history
   SET rating_algorithm_version = 'fixed-elo-legacy-v1'
 WHERE rating_algorithm_version IS NULL;

ALTER TABLE player_rating_history
  ALTER COLUMN rating_algorithm_version SET DEFAULT 'fixed-elo-legacy-v1',
  ALTER COLUMN rating_algorithm_version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'player_rating_history_algorithm_check'
       AND conrelid = 'public.player_rating_history'::regclass
  ) THEN
    ALTER TABLE player_rating_history
      ADD CONSTRAINT player_rating_history_algorithm_check
      CHECK (rating_algorithm_version = 'fixed-elo-legacy-v1');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS player_glicko2_ratings (
  player_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  rating NUMERIC(12,6) NOT NULL,
  rating_deviation NUMERIC(12,6) NOT NULL,
  volatility NUMERIC(12,9) NOT NULL,
  rated_game_count INT NOT NULL DEFAULT 0,
  is_provisional BOOLEAN GENERATED ALWAYS AS (rated_game_count < 10) STORED,
  algorithm_version TEXT NOT NULL,
  last_rating_period_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT player_glicko2_ratings_user_fk FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT player_glicko2_ratings_player_key_check CHECK (
    player_key = 'user:' || user_id::text
  ),
  CONSTRAINT player_glicko2_ratings_rating_check CHECK (
    rating BETWEEN -10000 AND 10000
  ),
  CONSTRAINT player_glicko2_ratings_deviation_check CHECK (
    rating_deviation > 0 AND rating_deviation <= 10000
  ),
  CONSTRAINT player_glicko2_ratings_volatility_check CHECK (
    volatility > 0 AND volatility <= 10
  ),
  CONSTRAINT player_glicko2_ratings_game_count_check CHECK (rated_game_count >= 0),
  CONSTRAINT player_glicko2_ratings_algorithm_check CHECK (
    algorithm_version = 'glicko2-v1-tau-0.5'
  ),
  CONSTRAINT player_glicko2_ratings_time_check CHECK (
    updated_at >= created_at AND last_rating_period_at >= created_at
  )
);

-- A legacy account can have three incompatible current per-board ratings.
-- Select its most recently updated row exactly; never average or select the
-- highest. Ties prefer more games, then the smaller board. All legacy rows
-- remain untouched in player_stats and player_rating_history.
INSERT INTO player_glicko2_ratings
  (player_key,user_id,rating,rating_deviation,volatility,rated_game_count,
   algorithm_version,last_rating_period_at)
SELECT 'user:' || account.id::text,
       account.id,
       COALESCE(legacy.rating, 1200),
       350,
       0.06,
       0,
       'glicko2-v1-tau-0.5',
       statement_timestamp()
  FROM users AS account
  LEFT JOIN LATERAL (
    SELECT stats.rating
      FROM player_stats AS stats
     WHERE stats.player_key = 'user:' || account.id::text
     ORDER BY stats.updated_at DESC NULLS LAST,
              stats.games DESC,
              stats.board_size ASC
     LIMIT 1
  ) AS legacy ON TRUE
ON CONFLICT (player_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS game_glicko2_rating_events (
  game_id UUID NOT NULL,
  player_key TEXT NOT NULL,
  opponent_key TEXT NOT NULL,
  opponent_kind TEXT NOT NULL CHECK (
    opponent_kind IN ('registered_human', 'calibrated_bot')
  ),
  opponent_profile_version TEXT,
  player_color TEXT NOT NULL CHECK (player_color IN ('black', 'white')),
  outcome_kind TEXT NOT NULL CHECK (
    outcome_kind IN ('win', 'loss', 'draw', 'no_result')
  ),
  score NUMERIC(2,1),
  finish_reason TEXT NOT NULL,
  game_result TEXT NOT NULL CHECK (LENGTH(game_result) BETWEEN 1 AND 40),
  game_finished_at TIMESTAMPTZ NOT NULL,
  opponent_rating NUMERIC(12,6) NOT NULL,
  opponent_rating_deviation NUMERIC(12,6) NOT NULL,
  rating_before NUMERIC(12,6) NOT NULL,
  rating_after NUMERIC(12,6) NOT NULL,
  rating_deviation_before NUMERIC(12,6) NOT NULL,
  rating_deviation_after NUMERIC(12,6) NOT NULL,
  volatility_before NUMERIC(12,9) NOT NULL,
  volatility_after NUMERIC(12,9) NOT NULL,
  rated_game_count_before INT NOT NULL,
  rated_game_count_after INT NOT NULL,
  last_rating_period_at_before TIMESTAMPTZ NOT NULL,
  last_rating_period_at_after TIMESTAMPTZ NOT NULL,
  algorithm_version TEXT NOT NULL,
  rating_period_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (game_id, player_key),
  CONSTRAINT game_glicko2_rating_events_game_fk FOREIGN KEY (game_id)
    REFERENCES games(id) ON DELETE RESTRICT,
  CONSTRAINT game_glicko2_rating_events_player_fk FOREIGN KEY (player_key)
    REFERENCES player_glicko2_ratings(player_key) ON DELETE RESTRICT,
  CONSTRAINT game_glicko2_rating_events_distinct_players_check CHECK (
    player_key <> opponent_key
  ),
  CONSTRAINT game_glicko2_rating_events_opponent_check CHECK (COALESCE((
    (
      opponent_kind = 'registered_human'
      AND opponent_key LIKE 'user:%'
      AND opponent_profile_version IS NULL
    )
    OR
    (
      opponent_kind = 'calibrated_bot'
      AND opponent_key LIKE 'bot:%'
      AND LENGTH(opponent_profile_version) BETWEEN 1 AND 120
    )
  ), FALSE)),
  CONSTRAINT game_glicko2_rating_events_outcome_check CHECK (COALESCE((
    (
      outcome_kind = 'no_result'
      AND score IS NULL
      AND rating_after = rating_before
      AND rating_deviation_after = rating_deviation_before
      AND volatility_after = volatility_before
      AND rated_game_count_after = rated_game_count_before
      AND last_rating_period_at_after = last_rating_period_at_before
    )
    OR
    (
      outcome_kind IN ('win', 'loss', 'draw')
      AND score = CASE outcome_kind WHEN 'win' THEN 1 WHEN 'loss' THEN 0 ELSE 0.5 END
      AND rated_game_count_after = rated_game_count_before + 1
      AND last_rating_period_at_after = rating_period_at
    )
  ), FALSE)),
  CONSTRAINT game_glicko2_rating_events_bounds_check CHECK (
    opponent_rating BETWEEN -10000 AND 10000
    AND rating_before BETWEEN -10000 AND 10000
    AND rating_after BETWEEN -10000 AND 10000
    AND opponent_rating_deviation > 0 AND opponent_rating_deviation <= 10000
    AND rating_deviation_before > 0 AND rating_deviation_before <= 10000
    AND rating_deviation_after > 0 AND rating_deviation_after <= 10000
    AND volatility_before > 0 AND volatility_before <= 10
    AND volatility_after > 0 AND volatility_after <= 10
    AND rated_game_count_before >= 0 AND rated_game_count_after >= 0
  ),
  CONSTRAINT game_glicko2_rating_events_algorithm_check CHECK (
    algorithm_version = 'glicko2-v1-tau-0.5'
  ),
  CONSTRAINT game_glicko2_rating_events_time_check CHECK (
    processed_at >= rating_period_at
  )
);

CREATE INDEX IF NOT EXISTS idx_game_glicko2_events_player_period
  ON game_glicko2_rating_events(player_key, rating_period_at DESC, game_id);

CREATE OR REPLACE FUNCTION public.guard_glicko2_rating_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM public.games WHERE id = OLD.game_id;
    IF NOT FOUND THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'Glicko-2 game rating evidence is append-only.' USING ERRCODE = '23514';
END
$$;

CREATE OR REPLACE FUNCTION public.validate_glicko2_rating_event_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD; player_state RECORD; opponent_state RECORD; expected_color TEXT; expected_outcome TEXT;
BEGIN
  SELECT * INTO game_row FROM public.games WHERE id = NEW.game_id FOR UPDATE;
  IF NOT FOUND OR game_row.status <> 'finished' OR game_row.finished_at IS NULL
    OR game_row.finish_reason IS NULL OR game_row.result IS NULL
    OR game_row.black_player_key = game_row.white_player_key
    OR NEW.player_key NOT IN (game_row.black_player_key, game_row.white_player_key)
    OR NEW.opponent_key IS DISTINCT FROM (CASE NEW.player_key
         WHEN game_row.black_player_key THEN game_row.white_player_key
         ELSE game_row.black_player_key END)
    OR NEW.opponent_kind <> 'registered_human'
    OR NEW.opponent_profile_version IS NOT NULL
    OR NEW.game_finished_at IS DISTINCT FROM game_row.finished_at
    OR NEW.finish_reason IS DISTINCT FROM game_row.finish_reason
    OR NEW.game_result IS DISTINCT FROM game_row.result
  THEN RAISE EXCEPTION 'Rating evidence requires one exact registered-human terminal game.' USING ERRCODE = '23514';
  END IF;
  expected_color := CASE NEW.player_key WHEN game_row.black_player_key THEN 'black' ELSE 'white' END;
  expected_outcome := CASE
    WHEN game_row.finish_reason IN ('japanese_no_result', 'japanese_repetition')
      AND game_row.winner_key IS NULL THEN 'no_result'
    WHEN game_row.winner_key IS NULL
      AND game_row.finish_reason IN ('score', 'legacy_score', 'japanese_adjudication') THEN 'draw'
    WHEN game_row.winner_key = NEW.player_key THEN 'win'
    WHEN game_row.winner_key IN (game_row.black_player_key, game_row.white_player_key) THEN 'loss'
    ELSE NULL END;
  IF expected_outcome IS NULL OR NEW.player_color IS DISTINCT FROM expected_color
    OR NEW.outcome_kind IS DISTINCT FROM expected_outcome
  THEN RAISE EXCEPTION 'Rating outcome contradicts the terminal game.' USING ERRCODE = '23514';
  END IF;
  IF (game_row.finish_reason = 'japanese_adjudication' AND NOT EXISTS (
        SELECT 1 FROM public.game_japanese_scoring_terminal_events
         WHERE game_id = NEW.game_id AND outcome_kind = 'katago_validated'
      ))
    OR (game_row.finish_reason = 'japanese_no_result' AND NOT EXISTS (
        SELECT 1 FROM public.game_japanese_scoring_terminal_events
         WHERE game_id = NEW.game_id
           AND outcome_kind IN ('katago_low_confidence', 'katago_unavailable', 'no_participation')
      ))
    OR (game_row.finish_reason = 'japanese_abandonment' AND NOT EXISTS (
        SELECT 1 FROM public.game_japanese_scoring_terminal_events
         WHERE game_id = NEW.game_id AND outcome_kind = 'abandonment'
      ))
    OR (game_row.finish_reason = 'japanese_repetition' AND NOT EXISTS (
        SELECT 1
          FROM public.game_japanese_repetition_claims AS claim
          JOIN LATERAL (
            SELECT move_number, board_hash
              FROM public.moves
             WHERE game_id = NEW.game_id
             ORDER BY move_number DESC
             LIMIT 1
          ) AS latest
            ON latest.move_number = claim.move_number
           AND latest.board_hash = claim.board_hash
         WHERE claim.game_id = NEW.game_id
         GROUP BY claim.game_id
        HAVING COUNT(*) = 2 AND COUNT(DISTINCT claim.claimant_color) = 2
      ))
  THEN RAISE EXCEPTION 'Japanese rating evidence requires exact terminal scoring evidence.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO player_state FROM public.player_glicko2_ratings
   WHERE player_key = NEW.player_key FOR UPDATE;
  SELECT * INTO opponent_state FROM public.player_glicko2_ratings
   WHERE player_key = NEW.opponent_key;
  IF player_state.player_key IS NULL OR opponent_state.player_key IS NULL
    OR player_state.algorithm_version <> NEW.algorithm_version
    OR player_state.rating IS DISTINCT FROM NEW.rating_before
    OR player_state.rating_deviation IS DISTINCT FROM NEW.rating_deviation_before
    OR player_state.volatility IS DISTINCT FROM NEW.volatility_before
    OR player_state.rated_game_count IS DISTINCT FROM NEW.rated_game_count_before
    OR player_state.last_rating_period_at IS DISTINCT FROM NEW.last_rating_period_at_before
    OR opponent_state.rating IS DISTINCT FROM NEW.opponent_rating
    OR opponent_state.rating_deviation IS DISTINCT FROM NEW.opponent_rating_deviation
  THEN RAISE EXCEPTION 'Rating evidence must begin at the locked global states.' USING ERRCODE = '23514';
  END IF;
  NEW.processed_at := statement_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_glicko2_rating_event_commit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE event_count INT; companion RECORD; player_state RECORD;
BEGIN
  SELECT COUNT(*) INTO event_count FROM public.game_glicko2_rating_events
   WHERE game_id = NEW.game_id;
  SELECT * INTO companion FROM public.game_glicko2_rating_events
   WHERE game_id = NEW.game_id AND player_key = NEW.opponent_key;
  SELECT * INTO player_state FROM public.player_glicko2_ratings
   WHERE player_key = NEW.player_key;
  IF event_count <> 2 OR companion.game_id IS NULL OR player_state.player_key IS NULL
    OR companion.opponent_key IS DISTINCT FROM NEW.player_key
    OR companion.opponent_kind IS DISTINCT FROM NEW.opponent_kind
    OR companion.algorithm_version IS DISTINCT FROM NEW.algorithm_version
    OR companion.rating_period_at IS DISTINCT FROM NEW.rating_period_at
    OR companion.game_finished_at IS DISTINCT FROM NEW.game_finished_at
    OR companion.finish_reason IS DISTINCT FROM NEW.finish_reason
    OR companion.game_result IS DISTINCT FROM NEW.game_result
    OR companion.outcome_kind IS DISTINCT FROM (CASE NEW.outcome_kind
         WHEN 'win' THEN 'loss' WHEN 'loss' THEN 'win' ELSE NEW.outcome_kind END)
    OR companion.opponent_rating IS DISTINCT FROM NEW.rating_before
    OR companion.opponent_rating_deviation IS DISTINCT FROM NEW.rating_deviation_before
    OR NEW.opponent_rating IS DISTINCT FROM companion.rating_before
    OR NEW.opponent_rating_deviation IS DISTINCT FROM companion.rating_deviation_before
    OR player_state.rating IS DISTINCT FROM NEW.rating_after
    OR player_state.rating_deviation IS DISTINCT FROM NEW.rating_deviation_after
    OR player_state.volatility IS DISTINCT FROM NEW.volatility_after
    OR player_state.rated_game_count IS DISTINCT FROM NEW.rated_game_count_after
    OR player_state.last_rating_period_at IS DISTINCT FROM NEW.last_rating_period_at_after
    OR player_state.algorithm_version IS DISTINCT FROM NEW.algorithm_version
  THEN RAISE EXCEPTION 'Glicko-2 evidence requires one complete paired state transition.' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.guard_glicko2_rating_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_glicko2_rating_event_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_glicko2_rating_event_commit() FROM PUBLIC;

DROP TRIGGER IF EXISTS game_glicko2_rating_events_insert_guard ON game_glicko2_rating_events;
DROP TRIGGER IF EXISTS game_glicko2_rating_events_commit_guard ON game_glicko2_rating_events;
DROP TRIGGER IF EXISTS game_glicko2_rating_events_immutable_guard ON game_glicko2_rating_events;
DROP TRIGGER IF EXISTS game_glicko2_rating_events_truncate_guard ON game_glicko2_rating_events;
CREATE TRIGGER game_glicko2_rating_events_insert_guard
  BEFORE INSERT ON game_glicko2_rating_events FOR EACH ROW
  EXECUTE FUNCTION public.validate_glicko2_rating_event_insert();
CREATE CONSTRAINT TRIGGER game_glicko2_rating_events_commit_guard
  AFTER INSERT ON game_glicko2_rating_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_glicko2_rating_event_commit();
CREATE TRIGGER game_glicko2_rating_events_immutable_guard
  BEFORE UPDATE OR DELETE ON game_glicko2_rating_events FOR EACH ROW
  EXECUTE FUNCTION public.guard_glicko2_rating_event_mutation();
CREATE TRIGGER game_glicko2_rating_events_truncate_guard
  BEFORE TRUNCATE ON game_glicko2_rating_events FOR EACH STATEMENT
  EXECUTE FUNCTION public.guard_glicko2_rating_event_mutation();

ALTER TABLE player_glicko2_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_glicko2_rating_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON player_glicko2_ratings FROM PUBLIC;
REVOKE ALL ON game_glicko2_rating_events FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT,INSERT,UPDATE ON player_glicko2_ratings TO gostone_app;
    GRANT SELECT,INSERT ON game_glicko2_rating_events TO gostone_app;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='player_glicko2_ratings' AND policyname='gostone_app_server_access') THEN
      CREATE POLICY gostone_app_server_access ON player_glicko2_ratings
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='game_glicko2_rating_events' AND policyname='gostone_app_server_read') THEN
      CREATE POLICY gostone_app_server_read ON game_glicko2_rating_events
        FOR SELECT TO gostone_app USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='game_glicko2_rating_events' AND policyname='gostone_app_server_insert') THEN
      CREATE POLICY gostone_app_server_insert ON game_glicko2_rating_events
        FOR INSERT TO gostone_app WITH CHECK (true);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON player_glicko2_ratings, game_glicko2_rating_events FROM anon;
    REVOKE ALL ON FUNCTION public.guard_glicko2_rating_event_mutation(),
      public.validate_glicko2_rating_event_insert(),
      public.validate_glicko2_rating_event_commit() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON player_glicko2_ratings, game_glicko2_rating_events FROM authenticated;
    REVOKE ALL ON FUNCTION public.guard_glicko2_rating_event_mutation(),
      public.validate_glicko2_rating_event_insert(),
      public.validate_glicko2_rating_event_commit() FROM authenticated;
  END IF;
END
$$;
-- Persist player-controlled rating presentation separately from immutable
-- starting-rating evidence, then snapshot authoritative adaptive-match state.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS player_rating_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  player_key TEXT GENERATED ALWAYS AS ('user:' || user_id::text) STORED UNIQUE,
  display_preference TEXT NOT NULL DEFAULT 'both' CHECK (
    display_preference IN ('rank-primary', 'rating-primary', 'both')
  ),
  bot_match_preference TEXT NOT NULL DEFAULT 'never' CHECK (
    bot_match_preference IN ('never', 'calibrated-rated-after-wait')
  ),
  handicap_preference TEXT NOT NULL DEFAULT 'even-only' CHECK (
    handicap_preference IN ('even-only', 'verified-handicap-ok')
  ),
  preference_revision INT NOT NULL DEFAULT 1 CHECK (preference_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS player_initial_rating_claims (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  estimate TEXT NOT NULL CHECK (
    estimate IN ('unspecified', 'new', 'beginner', 'intermediate', 'experienced', 'known')
  ),
  known_rank TEXT,
  applied_initial_rating NUMERIC(12,6) NOT NULL CHECK (
    applied_initial_rating BETWEEN -10000 AND 10000
  ),
  applied_initial_deviation NUMERIC(12,6) NOT NULL CHECK (
    applied_initial_deviation = 350
  ),
  policy_version TEXT NOT NULL CHECK (policy_version = 'starting-strength-v1'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CHECK (
    (estimate = 'known' AND known_rank ~ '^(?:([1-9]|[12][0-9]|30)k|[1-9]d)$')
    OR (estimate <> 'known' AND known_rank IS NULL)
  )
);

-- Existing accounts were migrated from legacy state in migration 026. Do not
-- invent an onboarding claim for them and never silently opt them into bots.
INSERT INTO player_rating_preferences (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.guard_initial_rating_claim_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM public.users WHERE id = OLD.user_id;
    IF NOT FOUND THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'Initial rating claims are append-only.' USING ERRCODE = '23514';
END
$$;

CREATE OR REPLACE FUNCTION public.validate_initial_rating_claim_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE rating_state RECORD;
BEGIN
  SELECT * INTO rating_state FROM public.player_glicko2_ratings
   WHERE user_id = NEW.user_id FOR UPDATE;
  IF rating_state.user_id IS NULL
    OR rating_state.rated_game_count <> 0
    OR EXISTS (
      SELECT 1 FROM public.game_glicko2_rating_events
       WHERE player_key = rating_state.player_key
    )
    OR rating_state.rating IS DISTINCT FROM NEW.applied_initial_rating
    OR rating_state.rating_deviation IS DISTINCT FROM NEW.applied_initial_deviation
    OR rating_state.created_at > NEW.applied_at
  THEN
    RAISE EXCEPTION 'Initial rating claim must match a new unrated global state.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_rating_preference_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.player_key IS DISTINCT FROM OLD.player_key
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.preference_revision <> OLD.preference_revision + 1
    OR NEW.updated_at <= OLD.updated_at
  THEN
    RAISE EXCEPTION 'Rating preference updates require one monotonic revision.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS player_rating_preferences_update_guard ON player_rating_preferences;
CREATE TRIGGER player_rating_preferences_update_guard
  BEFORE UPDATE ON player_rating_preferences FOR EACH ROW
  EXECUTE FUNCTION public.guard_rating_preference_update();

DROP TRIGGER IF EXISTS player_initial_rating_claims_insert_guard ON player_initial_rating_claims;
DROP TRIGGER IF EXISTS player_initial_rating_claims_immutable_guard ON player_initial_rating_claims;
DROP TRIGGER IF EXISTS player_initial_rating_claims_truncate_guard ON player_initial_rating_claims;
CREATE TRIGGER player_initial_rating_claims_insert_guard
  BEFORE INSERT ON player_initial_rating_claims FOR EACH ROW
  EXECUTE FUNCTION public.validate_initial_rating_claim_insert();
CREATE TRIGGER player_initial_rating_claims_immutable_guard
  BEFORE UPDATE OR DELETE ON player_initial_rating_claims FOR EACH ROW
  EXECUTE FUNCTION public.guard_initial_rating_claim_mutation();
CREATE TRIGGER player_initial_rating_claims_truncate_guard
  BEFORE TRUNCATE ON player_initial_rating_claims FOR EACH STATEMENT
  EXECUTE FUNCTION public.guard_initial_rating_claim_mutation();

ALTER TABLE matchmaking_queue
  ADD COLUMN IF NOT EXISTS matchmaking_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS match_pool TEXT,
  ADD COLUMN IF NOT EXISTS rules_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS rules_version_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS scoring_method_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS komi_snapshot NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS handicap_snapshot INT,
  ADD COLUMN IF NOT EXISTS rating_snapshot NUMERIC(12,6),
  ADD COLUMN IF NOT EXISTS rating_deviation_snapshot NUMERIC(12,6),
  ADD COLUMN IF NOT EXISTS rating_algorithm_version TEXT,
  ADD COLUMN IF NOT EXISTS rating_state_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preference_revision INT,
  ADD COLUMN IF NOT EXISTS display_preference_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS bot_match_preference TEXT,
  ADD COLUMN IF NOT EXISTS reliable_latency_ms INT,
  ADD COLUMN IF NOT EXISTS latency_evidence_version TEXT,
  ADD COLUMN IF NOT EXISTS latency_observed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS abandonment_risk TEXT,
  ADD COLUMN IF NOT EXISTS abandonment_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS abandonment_evaluated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handicap_preference TEXT,
  ADD COLUMN IF NOT EXISTS bot_fallback_not_before TIMESTAMPTZ;

-- Rows that predate the adaptive contract may drain as legacy rows. New joins
-- are written with the complete v1 tuple by application code.
UPDATE matchmaking_queue
   SET match_pool = CASE
         WHEN EXISTS (
           SELECT 1 FROM users account
            WHERE matchmaking_queue.player_key = 'user:' || account.id::text
         ) THEN 'registered-rated'
         ELSE 'guest-unrated'
       END,
       bot_match_preference = 'never',
       abandonment_risk = 'normal',
       handicap_preference = 'even-only'
 WHERE match_pool IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'matchmaking_queue_adaptive_state_check'
       AND conrelid = 'public.matchmaking_queue'::regclass
  ) THEN
    ALTER TABLE matchmaking_queue ADD CONSTRAINT matchmaking_queue_adaptive_state_check CHECK (
      matchmaking_policy_version IS NULL
      OR COALESCE((
        matchmaking_policy_version = 'adaptive-global-glicko-match-v1'
        AND rules_snapshot IN ('japanese', 'chinese')
        AND LENGTH(rules_version_snapshot) BETWEEN 1 AND 120
        AND scoring_method_snapshot IN ('territory', 'area')
        AND komi_snapshot IS NOT NULL
        AND handicap_snapshot >= 0
        AND preference_revision > 0
        AND bot_match_preference IN (
          'never', 'calibrated-rated-after-wait'
        )
        AND abandonment_risk IN ('normal', 'elevated', 'restricted')
        AND abandonment_policy_version = 'abandonment-risk-v1'
        AND abandonment_evaluated_at IS NOT NULL
        AND handicap_preference IN ('even-only', 'verified-handicap-ok')
        AND (
          (match_pool = 'registered-rated'
           AND player_key LIKE 'user:%'
           AND display_preference_snapshot IN ('rank-primary','rating-primary','both')
           AND rating_snapshot BETWEEN -10000 AND 10000
           AND rating_deviation_snapshot > 0 AND rating_deviation_snapshot <= 10000
           AND rating_algorithm_version = 'glicko2-v1-tau-0.5'
           AND rating_state_updated_at IS NOT NULL)
          OR
          (match_pool = 'guest-unrated'
           AND player_key LIKE 'guest:%'
           AND rating_snapshot IS NULL
           AND rating_deviation_snapshot IS NULL
           AND display_preference_snapshot IS NULL
           AND rating_algorithm_version IS NULL
           AND rating_state_updated_at IS NULL
           AND bot_match_preference = 'never')
        )
        AND (
          (reliable_latency_ms IS NULL AND latency_evidence_version IS NULL
           AND latency_observed_at IS NULL)
          OR
          (reliable_latency_ms BETWEEN 0 AND 2000
           AND latency_evidence_version = 'server-rtt-v1'
           AND latency_observed_at IS NOT NULL)
        )
      ), FALSE)
    );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_matchmaking_adaptive_waiting
  ON matchmaking_queue(
    matchmaking_policy_version, match_pool, board_size, time_control,
    rules_profile, created_at, player_key
  )
  INCLUDE (
    rating_snapshot, rating_deviation_snapshot, reliable_latency_ms,
    abandonment_risk, handicap_preference, bot_match_preference
  )
  WHERE status = 'waiting';

ALTER TABLE player_rating_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_initial_rating_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON player_rating_preferences, player_initial_rating_claims FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_initial_rating_claim_mutation(),
  public.validate_initial_rating_claim_insert(),
  public.guard_rating_preference_update() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT, INSERT, UPDATE ON player_rating_preferences TO gostone_app;
    GRANT SELECT, INSERT ON player_initial_rating_claims TO gostone_app;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public'
       AND tablename = 'player_rating_preferences'
       AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON player_rating_preferences
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public'
       AND tablename = 'player_initial_rating_claims'
       AND policyname = 'gostone_app_server_access'
    ) THEN
      CREATE POLICY gostone_app_server_access ON player_initial_rating_claims
        FOR ALL TO gostone_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON player_rating_preferences, player_initial_rating_claims FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON player_rating_preferences, player_initial_rating_claims FROM authenticated;
  END IF;
END
$$;
-- Calibrated bots are rating opponents only through immutable accepted
-- profiles, append-only activation, exact per-game binding, and execution logs.
-- No profile or activation is seeded: production remains fail-closed until
-- genuine calibration evidence is independently accepted.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS calibrated_bot_profiles (
  profile_id TEXT PRIMARY KEY CHECK (profile_id ~ '^bot:[a-z0-9][a-z0-9-]{1,62}:v[1-9][0-9]*$'),
  profile_contract_version TEXT NOT NULL CHECK (profile_contract_version = 'calibrated-bot-profile-v1'),
  profile_fingerprint TEXT NOT NULL UNIQUE CHECK (profile_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  transparent_name TEXT NOT NULL CHECK (LENGTH(transparent_name) BETWEEN 1 AND 160),
  engine_family TEXT NOT NULL CHECK (LENGTH(engine_family) BETWEEN 1 AND 160),
  engine_version TEXT NOT NULL CHECK (LENGTH(engine_version) BETWEEN 1 AND 160),
  model_version TEXT NOT NULL CHECK (LENGTH(model_version) BETWEEN 1 AND 160),
  config_version TEXT NOT NULL CHECK (LENGTH(config_version) BETWEEN 1 AND 160),
  fixed_rating NUMERIC(12,6) NOT NULL CHECK (fixed_rating BETWEEN -10000 AND 10000),
  fixed_rating_deviation NUMERIC(12,6) NOT NULL CHECK (fixed_rating_deviation > 0 AND fixed_rating_deviation <= 350),
  handicap_mode TEXT NOT NULL CHECK (handicap_mode IN ('even', 'verified-handicap')),
  acceptance_policy_version TEXT NOT NULL CHECK (acceptance_policy_version = 'bot-calibration-acceptance-v1'),
  source_revision TEXT NOT NULL CHECK (source_revision ~ '^[0-9a-f]{40}$'),
  dataset_digest TEXT NOT NULL CHECK (dataset_digest ~ '^sha256:[0-9a-f]{64}$'),
  runner_digest TEXT NOT NULL CHECK (runner_digest ~ '^sha256:[0-9a-f]{64}$'),
  reproduction_command TEXT NOT NULL CHECK (LENGTH(reproduction_command) BETWEEN 1 AND 1000),
  calibration_games INT NOT NULL CHECK (calibration_games >= 500),
  holdout_games INT NOT NULL CHECK (holdout_games >= 100 AND holdout_games <= calibration_games),
  distinct_registered_humans INT NOT NULL CHECK (distinct_registered_humans >= 100 AND distinct_registered_humans <= calibration_games),
  estimated_rating NUMERIC(12,6) NOT NULL,
  standard_error NUMERIC(12,6) NOT NULL CHECK (standard_error > 0 AND standard_error <= 75),
  unresolved_audit_findings INT NOT NULL CHECK (unresolved_audit_findings = 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CHECK (ABS(fixed_rating - estimated_rating) <= 100),
  CHECK (fixed_rating_deviation >= standard_error),
  UNIQUE (profile_id, profile_fingerprint)
);

CREATE TABLE IF NOT EXISTS calibrated_bot_profile_configurations (
  profile_id TEXT NOT NULL REFERENCES calibrated_bot_profiles(profile_id) ON DELETE RESTRICT,
  configuration_key TEXT NOT NULL CHECK (configuration_key ~ '^[0-9a-f]{64}$'),
  board_size INT NOT NULL CHECK (board_size IN (9,13,19)),
  time_control TEXT NOT NULL CHECK (time_control IN ('blitz','rapid','classic')),
  rules_profile TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  komi NUMERIC(4,1) NOT NULL,
  handicap INT NOT NULL CHECK (handicap >= 0),
  calibration_games INT NOT NULL CHECK (calibration_games >= 50),
  PRIMARY KEY (profile_id, configuration_key),
  UNIQUE (profile_id,board_size,time_control,rules_profile,rules_version,komi,handicap)
);

CREATE TABLE IF NOT EXISTS calibrated_bot_profile_activation_events (
  activation_id BIGSERIAL PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES calibrated_bot_profiles(profile_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('activate','deactivate')),
  reason TEXT NOT NULL CHECK (LENGTH(reason) BETWEEN 1 AND 500),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);

ALTER TABLE game_bots
  ADD COLUMN IF NOT EXISTS rating_mode TEXT NOT NULL DEFAULT 'unrated' CHECK (
    rating_mode IN ('unrated','calibrated-v1')
  );

CREATE TABLE IF NOT EXISTS game_calibrated_bot_bindings (
  game_id UUID PRIMARY KEY REFERENCES games(id) ON DELETE RESTRICT,
  bot_player_key TEXT NOT NULL,
  bot_color TEXT NOT NULL CHECK (bot_color IN ('black','white')),
  human_player_key TEXT NOT NULL CHECK (human_player_key LIKE 'user:%'),
  profile_id TEXT NOT NULL,
  activation_id BIGINT NOT NULL REFERENCES calibrated_bot_profile_activation_events(activation_id) ON DELETE RESTRICT,
  binding_version TEXT NOT NULL CHECK (binding_version = 'bot-opponent-binding-v1'),
  profile_contract_version TEXT NOT NULL,
  profile_fingerprint TEXT NOT NULL,
  engine_family TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  config_version TEXT NOT NULL,
  opponent_rating NUMERIC(12,6) NOT NULL,
  opponent_rating_deviation NUMERIC(12,6) NOT NULL,
  configuration_key TEXT NOT NULL,
  credit_mode TEXT NOT NULL CHECK (credit_mode = 'fixed-versioned-profile'),
  rating_credit_policy_version TEXT NOT NULL CHECK (rating_credit_policy_version = 'calibrated-bot-rating-credit-v1'),
  bound_game_version INT NOT NULL CHECK (bound_game_version = 0),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (game_id,bot_player_key),
  FOREIGN KEY (profile_id,profile_fingerprint)
    REFERENCES calibrated_bot_profiles(profile_id,profile_fingerprint) ON DELETE RESTRICT,
  FOREIGN KEY (profile_id,configuration_key)
    REFERENCES calibrated_bot_profile_configurations(profile_id,configuration_key) ON DELETE RESTRICT,
  CHECK (bot_player_key LIKE 'bot:%' AND bot_player_key <> human_player_key)
);

CREATE TABLE IF NOT EXISTS game_calibrated_bot_actions (
  game_id UUID NOT NULL REFERENCES game_calibrated_bot_bindings(game_id) ON DELETE RESTRICT,
  action_sequence INT NOT NULL CHECK (action_sequence > 0),
  request_identity TEXT NOT NULL CHECK (LENGTH(request_identity) BETWEEN 1 AND 200),
  action_kind TEXT NOT NULL CHECK (action_kind IN ('move','pass','resign')),
  move_number INT CHECK (move_number IS NULL OR move_number > 0),
  x INT CHECK (x IS NULL OR x BETWEEN 0 AND 18),
  y INT CHECK (y IS NULL OR y BETWEEN 0 AND 18),
  profile_id TEXT NOT NULL,
  profile_fingerprint TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  config_version TEXT NOT NULL,
  worker_id TEXT NOT NULL CHECK (LENGTH(worker_id) BETWEEN 1 AND 160),
  completed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (game_id,action_sequence),
  UNIQUE (game_id,request_identity),
  CHECK (
    (action_kind = 'move' AND move_number IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL)
    OR (action_kind IN ('pass','resign') AND x IS NULL AND y IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calibrated_bot_action_move_once
  ON game_calibrated_bot_actions(game_id,move_number)
  WHERE action_kind IN ('move','pass');
CREATE UNIQUE INDEX IF NOT EXISTS idx_calibrated_bot_action_resign_once
  ON game_calibrated_bot_actions(game_id)
  WHERE action_kind = 'resign';

ALTER TABLE game_glicko2_rating_events
  ADD COLUMN IF NOT EXISTS opponent_profile_id TEXT,
  ADD COLUMN IF NOT EXISTS opponent_profile_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS opponent_binding_version TEXT,
  ADD COLUMN IF NOT EXISTS opponent_configuration_key TEXT,
  ADD COLUMN IF NOT EXISTS opponent_credit_mode TEXT;

ALTER TABLE game_glicko2_rating_events
  DROP CONSTRAINT IF EXISTS game_glicko2_rating_events_opponent_check;
ALTER TABLE game_glicko2_rating_events
  ADD CONSTRAINT game_glicko2_rating_events_opponent_check CHECK (COALESCE((
    (opponent_kind = 'registered_human' AND opponent_key LIKE 'user:%'
      AND opponent_profile_version IS NULL AND opponent_profile_id IS NULL
      AND opponent_profile_fingerprint IS NULL AND opponent_binding_version IS NULL
      AND opponent_configuration_key IS NULL AND opponent_credit_mode IS NULL)
    OR
    (opponent_kind = 'calibrated_bot' AND opponent_key LIKE 'bot:%'
      AND opponent_profile_version IS NOT NULL AND opponent_profile_id IS NOT NULL
      AND opponent_profile_fingerprint ~ '^sha256:[0-9a-f]{64}$'
      AND opponent_binding_version = 'bot-opponent-binding-v1'
      AND opponent_configuration_key ~ '^[0-9a-f]{64}$'
      AND opponent_credit_mode = 'fixed-versioned-profile')
  ), FALSE));

CREATE OR REPLACE FUNCTION public.guard_calibrated_bot_evidence_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Calibrated bot evidence is append-only.' USING ERRCODE = '23514';
END
$$;

CREATE OR REPLACE FUNCTION public.validate_calibrated_bot_activation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE previous_action TEXT; profile_row RECORD; configuration_total INT;
BEGIN
  SELECT * INTO profile_row FROM public.calibrated_bot_profiles
   WHERE profile_id = NEW.profile_id FOR UPDATE;
  SELECT action INTO previous_action FROM public.calibrated_bot_profile_activation_events
   WHERE profile_id = NEW.profile_id ORDER BY activation_id DESC LIMIT 1 FOR UPDATE;
  SELECT COALESCE(SUM(calibration_games),0) INTO configuration_total
    FROM public.calibrated_bot_profile_configurations WHERE profile_id = NEW.profile_id;
  IF profile_row.profile_id IS NULL OR configuration_total <> profile_row.calibration_games
    OR (NEW.action = 'activate' AND previous_action = 'activate')
    OR (NEW.action = 'deactivate' AND previous_action IS DISTINCT FROM 'activate')
  THEN RAISE EXCEPTION 'Bot activation requires complete accepted calibration and monotonic state.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_calibrated_bot_binding()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD; bot_row RECORD; queue_row RECORD; profile_row RECORD; config_row RECORD; activation_row RECORD;
BEGIN
  SELECT * INTO game_row FROM public.games WHERE id = NEW.game_id FOR UPDATE;
  SELECT * INTO bot_row FROM public.game_bots WHERE game_id = NEW.game_id FOR UPDATE;
  SELECT * INTO profile_row FROM public.calibrated_bot_profiles WHERE profile_id = NEW.profile_id;
  SELECT * INTO config_row FROM public.calibrated_bot_profile_configurations
   WHERE profile_id = NEW.profile_id AND configuration_key = NEW.configuration_key;
  SELECT * INTO queue_row FROM public.matchmaking_queue
   WHERE player_key = NEW.human_player_key AND game_id = NEW.game_id AND status = 'matched';
  SELECT * INTO activation_row FROM public.calibrated_bot_profile_activation_events
   WHERE activation_id = NEW.activation_id AND profile_id = NEW.profile_id;
  IF game_row.id IS NULL OR game_row.status <> 'active' OR game_row.version <> 0
    OR EXISTS (SELECT 1 FROM public.moves WHERE game_id = NEW.game_id)
    OR bot_row.bot_player_key IS DISTINCT FROM NEW.bot_player_key
    OR bot_row.color IS DISTINCT FROM NEW.bot_color OR bot_row.rating_mode <> 'calibrated-v1'
    OR NEW.human_player_key IS DISTINCT FROM (CASE NEW.bot_color
         WHEN 'black' THEN game_row.white_player_key ELSE game_row.black_player_key END)
    OR NEW.bot_player_key IS DISTINCT FROM (CASE NEW.bot_color
         WHEN 'black' THEN game_row.black_player_key ELSE game_row.white_player_key END)
    OR queue_row.player_key IS NULL OR queue_row.match_pool <> 'registered-rated'
    OR queue_row.bot_match_preference <> 'calibrated-rated-after-wait'
    OR queue_row.matchmaking_policy_version <> 'adaptive-global-glicko-match-v1'
    OR queue_row.board_size <> game_row.board_size
    OR queue_row.time_control <> game_row.time_control
    OR queue_row.rules_snapshot <> game_row.rules
    OR queue_row.rules_profile <> game_row.rules_profile
    OR queue_row.scoring_method_snapshot <> game_row.scoring_method
    OR queue_row.komi_snapshot <> game_row.komi
    OR queue_row.handicap_snapshot <> game_row.handicap
    OR profile_row.profile_id IS NULL OR activation_row.action <> 'activate'
    OR bot_row.target_rating IS DISTINCT FROM
       ROUND(profile_row.fixed_rating)::INT
    OR EXISTS (SELECT 1 FROM public.calibrated_bot_profile_activation_events later
                WHERE later.profile_id = NEW.profile_id AND later.activation_id > NEW.activation_id)
    OR profile_row.profile_contract_version IS DISTINCT FROM NEW.profile_contract_version
    OR profile_row.profile_fingerprint IS DISTINCT FROM NEW.profile_fingerprint
    OR profile_row.engine_family IS DISTINCT FROM NEW.engine_family
    OR profile_row.engine_version IS DISTINCT FROM NEW.engine_version
    OR profile_row.model_version IS DISTINCT FROM NEW.model_version
    OR profile_row.config_version IS DISTINCT FROM NEW.config_version
    OR profile_row.fixed_rating IS DISTINCT FROM NEW.opponent_rating
    OR profile_row.fixed_rating_deviation IS DISTINCT FROM NEW.opponent_rating_deviation
    OR config_row.profile_id IS NULL OR config_row.board_size <> game_row.board_size
    OR config_row.time_control <> game_row.time_control
    OR config_row.rules_profile <> game_row.rules_profile
    OR config_row.rules_version <> queue_row.rules_version_snapshot
    OR config_row.komi <> game_row.komi OR config_row.handicap <> game_row.handicap
  THEN RAISE EXCEPTION 'Rated bot binding does not match accepted profile, activation, game, and execution identity.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_calibrated_bot_action_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE binding_row RECORD; game_row RECORD;
BEGIN
  SELECT * INTO binding_row FROM public.game_calibrated_bot_bindings
   WHERE game_id = NEW.game_id FOR UPDATE;
  SELECT * INTO game_row FROM public.games WHERE id = NEW.game_id FOR UPDATE;
  IF binding_row.game_id IS NULL OR NEW.completed_at < binding_row.bound_at
    OR NEW.completed_at > statement_timestamp()
    OR NEW.profile_id IS DISTINCT FROM binding_row.profile_id
    OR NEW.profile_fingerprint IS DISTINCT FROM binding_row.profile_fingerprint
    OR NEW.engine_version IS DISTINCT FROM binding_row.engine_version
    OR NEW.model_version IS DISTINCT FROM binding_row.model_version
    OR NEW.config_version IS DISTINCT FROM binding_row.config_version
    OR (
      NEW.action_kind IN ('move','pass') AND NOT EXISTS (
        SELECT 1 FROM public.moves move
         WHERE move.game_id = NEW.game_id AND move.move_number = NEW.move_number
           AND move.color = binding_row.bot_color
           AND NEW.action_kind = CASE WHEN move.is_pass THEN 'pass' ELSE 'move' END
           AND NEW.x IS NOT DISTINCT FROM move.x AND NEW.y IS NOT DISTINCT FROM move.y
      )
    )
    OR (
      NEW.action_kind = 'resign' AND NOT (
        game_row.status = 'finished' AND game_row.finish_reason = 'resignation'
        AND game_row.winner_key = binding_row.human_player_key
      )
    )
  THEN RAISE EXCEPTION 'Calibrated bot action does not match its immutable binding and persisted game action.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_bound_game_bot_identity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.game_calibrated_bot_bindings binding WHERE binding.game_id = OLD.game_id)
    AND (NEW.bot_player_key IS DISTINCT FROM OLD.bot_player_key
      OR NEW.color IS DISTINCT FROM OLD.color
      OR NEW.rating_mode IS DISTINCT FROM OLD.rating_mode
      OR NEW.target_rating IS DISTINCT FROM OLD.target_rating
      OR NEW.visits_per_turn IS DISTINCT FROM OLD.visits_per_turn
      OR NEW.candidate_limit IS DISTINCT FROM OLD.candidate_limit
      OR NEW.temperature IS DISTINCT FROM OLD.temperature)
  THEN RAISE EXCEPTION 'A calibrated game cannot change its bound bot identity or rating mode.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS calibrated_bot_activation_insert_guard ON calibrated_bot_profile_activation_events;
CREATE TRIGGER calibrated_bot_activation_insert_guard BEFORE INSERT
  ON calibrated_bot_profile_activation_events FOR EACH ROW
  EXECUTE FUNCTION public.validate_calibrated_bot_activation();
DROP TRIGGER IF EXISTS calibrated_bot_binding_insert_guard ON game_calibrated_bot_bindings;
CREATE TRIGGER calibrated_bot_binding_insert_guard BEFORE INSERT
  ON game_calibrated_bot_bindings FOR EACH ROW
  EXECUTE FUNCTION public.validate_calibrated_bot_binding();
DROP TRIGGER IF EXISTS calibrated_bot_action_insert_guard ON game_calibrated_bot_actions;
CREATE TRIGGER calibrated_bot_action_insert_guard BEFORE INSERT
  ON game_calibrated_bot_actions FOR EACH ROW
  EXECUTE FUNCTION public.validate_calibrated_bot_action_insert();
DROP TRIGGER IF EXISTS bound_game_bot_identity_guard ON game_bots;
CREATE TRIGGER bound_game_bot_identity_guard BEFORE UPDATE ON game_bots
  FOR EACH ROW EXECUTE FUNCTION public.guard_bound_game_bot_identity();

DO $$
DECLARE relation_name TEXT;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'calibrated_bot_profiles','calibrated_bot_profile_configurations',
    'calibrated_bot_profile_activation_events','game_calibrated_bot_bindings',
    'game_calibrated_bot_actions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS calibrated_bot_immutable_guard ON public.%I', relation_name);
    EXECUTE format('DROP TRIGGER IF EXISTS calibrated_bot_truncate_guard ON public.%I', relation_name);
    EXECUTE format('CREATE TRIGGER calibrated_bot_immutable_guard BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_calibrated_bot_evidence_mutation()', relation_name);
    EXECUTE format('CREATE TRIGGER calibrated_bot_truncate_guard BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guard_calibrated_bot_evidence_mutation()', relation_name);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_calibrated_bot_rating_event_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE game_row RECORD; binding_row RECORD; player_state RECORD; expected_color TEXT; expected_outcome TEXT;
BEGIN
  SELECT * INTO game_row FROM public.games WHERE id = NEW.game_id FOR UPDATE;
  SELECT * INTO binding_row FROM public.game_calibrated_bot_bindings
   WHERE game_id = NEW.game_id FOR UPDATE;
  expected_color := CASE NEW.player_key WHEN game_row.black_player_key THEN 'black'
                    WHEN game_row.white_player_key THEN 'white' ELSE NULL END;
  expected_outcome := CASE
    WHEN game_row.finish_reason IN ('japanese_no_result','japanese_repetition')
      AND game_row.winner_key IS NULL THEN 'no_result'
    WHEN game_row.winner_key IS NULL
      AND game_row.finish_reason IN ('score','legacy_score','japanese_adjudication') THEN 'draw'
    WHEN game_row.winner_key = NEW.player_key THEN 'win'
    WHEN game_row.winner_key IN (game_row.black_player_key,game_row.white_player_key) THEN 'loss'
    ELSE NULL END;
  IF game_row.status <> 'finished' OR game_row.finished_at IS NULL
    OR binding_row.game_id IS NULL OR binding_row.human_player_key <> NEW.player_key
    OR binding_row.bot_player_key <> NEW.opponent_key
    OR NEW.player_color IS DISTINCT FROM expected_color
    OR NEW.outcome_kind IS DISTINCT FROM expected_outcome
    OR NEW.game_finished_at IS DISTINCT FROM game_row.finished_at
    OR NEW.finish_reason IS DISTINCT FROM game_row.finish_reason
    OR NEW.game_result IS DISTINCT FROM game_row.result
    OR NEW.opponent_profile_version IS DISTINCT FROM binding_row.profile_contract_version
    OR NEW.opponent_profile_id IS DISTINCT FROM binding_row.profile_id
    OR NEW.opponent_profile_fingerprint IS DISTINCT FROM binding_row.profile_fingerprint
    OR NEW.opponent_binding_version IS DISTINCT FROM binding_row.binding_version
    OR NEW.opponent_configuration_key IS DISTINCT FROM binding_row.configuration_key
    OR NEW.opponent_credit_mode IS DISTINCT FROM binding_row.credit_mode
    OR NEW.opponent_rating IS DISTINCT FROM binding_row.opponent_rating
    OR NEW.opponent_rating_deviation IS DISTINCT FROM binding_row.opponent_rating_deviation
    OR EXISTS (
      SELECT 1 FROM public.moves bot_move
       WHERE bot_move.game_id = NEW.game_id AND bot_move.color = binding_row.bot_color
         AND NOT EXISTS (
           SELECT 1 FROM public.game_calibrated_bot_actions action
            WHERE action.game_id = NEW.game_id AND action.move_number = bot_move.move_number
              AND action.action_kind = CASE WHEN bot_move.x IS NULL THEN 'pass' ELSE 'move' END
              AND action.x IS NOT DISTINCT FROM bot_move.x AND action.y IS NOT DISTINCT FROM bot_move.y
              AND action.profile_id = binding_row.profile_id
              AND action.profile_fingerprint = binding_row.profile_fingerprint
              AND action.engine_version = binding_row.engine_version
              AND action.model_version = binding_row.model_version
              AND action.config_version = binding_row.config_version
         )
    )
  THEN RAISE EXCEPTION 'Calibrated bot rating evidence contradicts the bound game execution.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO player_state FROM public.player_glicko2_ratings
   WHERE player_key = NEW.player_key FOR UPDATE;
  IF player_state.player_key IS NULL OR player_state.algorithm_version <> NEW.algorithm_version
    OR player_state.rating IS DISTINCT FROM NEW.rating_before
    OR player_state.rating_deviation IS DISTINCT FROM NEW.rating_deviation_before
    OR player_state.volatility IS DISTINCT FROM NEW.volatility_before
    OR player_state.rated_game_count IS DISTINCT FROM NEW.rated_game_count_before
    OR player_state.last_rating_period_at IS DISTINCT FROM NEW.last_rating_period_at_before
  THEN RAISE EXCEPTION 'Bot rating evidence must begin at the locked human global state.' USING ERRCODE = '23514';
  END IF;
  NEW.processed_at := statement_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_calibrated_bot_rating_event_commit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE event_count INT; player_state RECORD;
BEGIN
  SELECT COUNT(*) INTO event_count FROM public.game_glicko2_rating_events
   WHERE game_id = NEW.game_id;
  SELECT * INTO player_state FROM public.player_glicko2_ratings
   WHERE player_key = NEW.player_key;
  IF event_count <> 1 OR player_state.player_key IS NULL
    OR player_state.rating IS DISTINCT FROM NEW.rating_after
    OR player_state.rating_deviation IS DISTINCT FROM NEW.rating_deviation_after
    OR player_state.volatility IS DISTINCT FROM NEW.volatility_after
    OR player_state.rated_game_count IS DISTINCT FROM NEW.rated_game_count_after
    OR player_state.last_rating_period_at IS DISTINCT FROM NEW.last_rating_period_at_after
    OR player_state.algorithm_version IS DISTINCT FROM NEW.algorithm_version
  THEN RAISE EXCEPTION 'Calibrated bot evidence requires one complete human state transition.' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS game_glicko2_rating_events_insert_guard ON game_glicko2_rating_events;
DROP TRIGGER IF EXISTS game_glicko2_rating_events_commit_guard ON game_glicko2_rating_events;
CREATE TRIGGER game_glicko2_rating_events_insert_guard
  BEFORE INSERT ON game_glicko2_rating_events FOR EACH ROW
  WHEN (NEW.opponent_kind = 'registered_human')
  EXECUTE FUNCTION public.validate_glicko2_rating_event_insert();
CREATE CONSTRAINT TRIGGER game_glicko2_rating_events_commit_guard
  AFTER INSERT ON game_glicko2_rating_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.opponent_kind = 'registered_human')
  EXECUTE FUNCTION public.validate_glicko2_rating_event_commit();
CREATE TRIGGER game_glicko2_calibrated_bot_event_insert_guard
  BEFORE INSERT ON game_glicko2_rating_events FOR EACH ROW
  WHEN (NEW.opponent_kind = 'calibrated_bot')
  EXECUTE FUNCTION public.validate_calibrated_bot_rating_event_insert();
CREATE CONSTRAINT TRIGGER game_glicko2_calibrated_bot_event_commit_guard
  AFTER INSERT ON game_glicko2_rating_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.opponent_kind = 'calibrated_bot')
  EXECUTE FUNCTION public.validate_calibrated_bot_rating_event_commit();

CREATE OR REPLACE FUNCTION public.validate_glicko2_state_transition()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.game_glicko2_rating_events event
     WHERE event.player_key = OLD.player_key
       AND event.rating_before IS NOT DISTINCT FROM OLD.rating
       AND event.rating_deviation_before IS NOT DISTINCT FROM OLD.rating_deviation
       AND event.volatility_before IS NOT DISTINCT FROM OLD.volatility
       AND event.rated_game_count_before IS NOT DISTINCT FROM OLD.rated_game_count
       AND event.last_rating_period_at_before IS NOT DISTINCT FROM OLD.last_rating_period_at
       AND event.rating_after IS NOT DISTINCT FROM NEW.rating
       AND event.rating_deviation_after IS NOT DISTINCT FROM NEW.rating_deviation
       AND event.volatility_after IS NOT DISTINCT FROM NEW.volatility
       AND event.rated_game_count_after IS NOT DISTINCT FROM NEW.rated_game_count
       AND event.last_rating_period_at_after IS NOT DISTINCT FROM NEW.last_rating_period_at
       AND event.algorithm_version IS NOT DISTINCT FROM NEW.algorithm_version
       AND event.rating_period_at > OLD.last_rating_period_at
  ) THEN
    RAISE EXCEPTION 'Global rating state changes require matching immutable game evidence.' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS player_glicko2_ratings_transition_guard ON player_glicko2_ratings;
CREATE TRIGGER player_glicko2_ratings_transition_guard
  BEFORE UPDATE ON player_glicko2_ratings FOR EACH ROW
  EXECUTE FUNCTION public.validate_glicko2_state_transition();

ALTER TABLE calibrated_bot_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibrated_bot_profile_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibrated_bot_profile_activation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_calibrated_bot_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_calibrated_bot_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON calibrated_bot_profiles,calibrated_bot_profile_configurations,
  calibrated_bot_profile_activation_events,game_calibrated_bot_bindings,
  game_calibrated_bot_actions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_calibrated_bot_evidence_mutation(),
  public.validate_calibrated_bot_activation(),public.validate_calibrated_bot_binding(),
  public.validate_calibrated_bot_action_insert(),public.guard_bound_game_bot_identity(),
  public.validate_calibrated_bot_rating_event_insert(),
  public.validate_calibrated_bot_rating_event_commit() FROM PUBLIC;

DO $$
DECLARE relation_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gostone_app') THEN
    GRANT SELECT ON calibrated_bot_profiles,calibrated_bot_profile_configurations,
      calibrated_bot_profile_activation_events TO gostone_app;
    GRANT SELECT,INSERT ON game_calibrated_bot_bindings,game_calibrated_bot_actions TO gostone_app;
    FOREACH relation_name IN ARRAY ARRAY[
      'calibrated_bot_profiles','calibrated_bot_profile_configurations',
      'calibrated_bot_profile_activation_events','game_calibrated_bot_bindings',
      'game_calibrated_bot_actions'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public'
          AND tablename = relation_name AND policyname = 'gostone_app_server_read'
      ) THEN
        EXECUTE format('CREATE POLICY gostone_app_server_read ON public.%I FOR SELECT TO gostone_app USING (true)', relation_name);
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='game_calibrated_bot_bindings' AND policyname='gostone_app_server_insert') THEN
      CREATE POLICY gostone_app_server_insert ON game_calibrated_bot_bindings
        FOR INSERT TO gostone_app WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='game_calibrated_bot_actions' AND policyname='gostone_app_server_insert') THEN
      CREATE POLICY gostone_app_server_insert ON game_calibrated_bot_actions
        FOR INSERT TO gostone_app WITH CHECK (true);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON calibrated_bot_profiles,calibrated_bot_profile_configurations,
      calibrated_bot_profile_activation_events,game_calibrated_bot_bindings,
      game_calibrated_bot_actions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON calibrated_bot_profiles,calibrated_bot_profile_configurations,
      calibrated_bot_profile_activation_events,game_calibrated_bot_bindings,
      game_calibrated_bot_actions FROM authenticated;
  END IF;
END
$$;
