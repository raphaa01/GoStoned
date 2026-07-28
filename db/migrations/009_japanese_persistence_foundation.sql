-- Dormant persistence foundation for a future Japanese-rules lifecycle.
-- This migration deliberately leaves every existing Chinese-only write gate
-- and the application rules registry unchanged. No Japanese game is playable
-- or insertable through the current application after this migration.

-- The migration runner wraps each numbered file in a transaction. Abort
-- instead of waiting indefinitely for locks on live matchmaking/game tables.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE matchmaking_queue
  ADD COLUMN IF NOT EXISTS rules_profile TEXT NOT NULL
    DEFAULT 'chinese-2002-gostone-v1';

UPDATE matchmaking_queue AS queue
   SET rules_profile = games.rules_profile
  FROM games
 WHERE queue.status = 'matched'
   AND queue.game_id = games.id;

UPDATE matchmaking_queue
   SET rules_profile = 'chinese-2002-gostone-v1'
 WHERE status = 'waiting';

-- During the expand phase, old application instances may omit rules_profile
-- or requeue a matched legacy row. Keep both Chinese profiles compatible and
-- make every matched row derive its truth from the linked game. A later
-- compatibility migration can narrow this before Japanese activation.
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

REVOKE ALL ON FUNCTION public.guard_game_rules_identity_mutation() FROM PUBLIC;

CREATE TRIGGER game_rules_identity_mutation_guard
  BEFORE UPDATE OF rules, rules_profile, scoring_method, komi, handicap
  ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_game_rules_identity_mutation();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'matchmaking_queue_rules_profile_compatibility_check'
  ) THEN
    ALTER TABLE matchmaking_queue
      ADD CONSTRAINT matchmaking_queue_rules_profile_compatibility_check
      CHECK (
        rules_profile IN (
          'legacy-immediate-area',
          'chinese-2002-gostone-v1'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'games_rules_identity_unique'
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
END
$$;

ALTER TABLE matchmaking_queue
  VALIDATE CONSTRAINT matchmaking_queue_rules_profile_compatibility_check;

-- Fail safely if an existing row cannot be interpreted by an exact versioned
-- tuple. The older narrow Chinese constraints remain in place, so the
-- Japanese branch of this constraint is documentation until activation.
ALTER TABLE games
  VALIDATE CONSTRAINT games_supported_rules_tuple_check;

DO $$
BEGIN
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
END
$$;

ALTER TABLE game_scoring_state
  VALIDATE CONSTRAINT game_scoring_state_game_rules_fk;

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

DO $$
BEGIN
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
END
$$;

ALTER TABLE game_japanese_scoring_state
  VALIDATE CONSTRAINT game_japanese_scoring_game_rules_fk;

-- Confirmations are acknowledgements of one canonical proposal digest. Child
-- evidence cannot change while either player has confirmed it, and finalized
-- evidence is immutable unless its parent game is being deleted by cascade.
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
      public.guard_japanese_scoring_state_mutation(),
      public.guard_japanese_scoring_evidence_mutation() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.enforce_matchmaking_rules_profile(),
      public.guard_game_rules_identity_mutation(),
      public.guard_japanese_scoring_state_mutation(),
      public.guard_japanese_scoring_evidence_mutation() FROM authenticated;
  END IF;
END
$$;

CREATE TRIGGER game_japanese_scoring_state_mutation_guard
  BEFORE UPDATE OR DELETE ON public.game_japanese_scoring_state
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_japanese_scoring_state_mutation();
CREATE TRIGGER game_japanese_dead_stones_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.game_japanese_dead_stones
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_japanese_scoring_evidence_mutation();
CREATE TRIGGER game_japanese_neutral_seeds_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.game_japanese_neutral_region_seeds
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_japanese_scoring_evidence_mutation();

CREATE INDEX IF NOT EXISTS idx_game_japanese_dead_stones_game_id
  ON game_japanese_dead_stones(game_id);
CREATE INDEX IF NOT EXISTS idx_game_japanese_neutral_region_seeds_game_id
  ON game_japanese_neutral_region_seeds(game_id);

ALTER TABLE game_japanese_scoring_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_japanese_dead_stones ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_japanese_neutral_region_seeds ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON game_japanese_scoring_state, game_japanese_dead_stones,
      game_japanese_neutral_region_seeds FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON game_japanese_scoring_state, game_japanese_dead_stones,
      game_japanese_neutral_region_seeds FROM authenticated;
  END IF;
END
$$;
