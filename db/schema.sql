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
  ), FALSE)
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
    OR (NEW.outcome_kind = 'abandonment' AND NEW.abandoned_by_color IS DISTINCT FROM CASE WHEN scoring_row.black_participated_at IS NULL THEN 'black' ELSE 'white' END)
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
    OR game_row.finish_reason IS DISTINCT FROM CASE NEW.outcome_kind
      WHEN 'abandonment' THEN 'japanese_abandonment'
      WHEN 'katago_validated' THEN 'japanese_adjudication'
      ELSE 'japanese_no_result' END
    OR game_row.winner_key IS DISTINCT FROM CASE NEW.winner_color
      WHEN 'black' THEN game_row.black_player_key
      WHEN 'white' THEN game_row.white_player_key ELSE NULL END
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
