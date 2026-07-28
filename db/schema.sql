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

REVOKE ALL ON FUNCTION public.guard_game_rules_identity_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_game_scoring_resume_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_game_scoring_resume_event_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_game_scoring_resume_event_commit() FROM PUBLIC;

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
BEGIN
  IF TG_OP = 'DELETE' THEN
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
      public.guard_japanese_scoring_state_mutation(),
      public.guard_japanese_scoring_evidence_mutation() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.enforce_matchmaking_rules_profile(),
      public.guard_game_rules_identity_mutation(),
      public.guard_game_scoring_resume_event_mutation(),
      public.validate_game_scoring_resume_event_insert(),
      public.validate_game_scoring_resume_event_commit(),
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
ALTER TABLE game_japanese_scoring_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_japanese_dead_stones ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_japanese_neutral_region_seeds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON game_scoring_resume_events FROM PUBLIC;
REVOKE ALL ON player_blocks FROM PUBLIC;
REVOKE ALL ON player_reports FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON schema_migrations, users, games, moves, player_stats, player_rating_history,
      matchmaking_queue, user_sessions, guest_sessions, auth_rate_limits, game_messages,
      player_blocks, player_reports,
      game_scoring_state, game_dead_stones, game_scoring_resume_events,
      game_japanese_scoring_state,
      game_japanese_dead_stones, game_japanese_neutral_region_seeds FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON schema_migrations, users, games, moves, player_stats, player_rating_history,
      matchmaking_queue, user_sessions, guest_sessions, auth_rate_limits, game_messages,
      player_blocks, player_reports,
      game_scoring_state, game_dead_stones, game_scoring_resume_events,
      game_japanese_scoring_state,
      game_japanese_dead_stones, game_japanese_neutral_region_seeds FROM authenticated;
  END IF;
END
$$;
