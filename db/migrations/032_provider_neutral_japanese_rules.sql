-- Japanese rules activation: provider-neutral manual-first lifecycle.
-- Persist the minimum immutable authority needed for the active Japanese
-- lifecycle, including resume, proposal, deadline, and repetition evidence.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'game_japanese_resume_authorizations_game_rules_fk'
       AND conrelid = 'public.game_japanese_resume_authorizations'::regclass
  ) THEN
    ALTER TABLE game_japanese_resume_authorizations
      ADD CONSTRAINT game_japanese_resume_authorizations_game_rules_fk
      FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)
      REFERENCES games (id, rules, rules_profile, scoring_method, komi, handicap)
      ON DELETE CASCADE;
  END IF;
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

  -- Permit only the database-owned cascade after the parent game is gone.
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
  -- Lock the game first. Every Japanese resume writer must use this order so
  -- concurrent move, scoring, confirmation, and resume attempts serialize.
  SELECT
      game.status,
      game.phase,
      game.to_move,
      game.consecutive_passes,
      game.scoring_revision,
      game.rules,
      game.rules_profile,
      game.scoring_method,
      game.komi,
      game.handicap
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

  -- Lock scoring state only after its game row. One confirmation is compatible
  -- with resuming play; mutual confirmation or finalization is not.
  SELECT
      scoring.board_hash,
      scoring.stopped_move_number,
      scoring.revision,
      scoring.rules,
      scoring.rules_profile,
      scoring.scoring_method,
      scoring.komi,
      scoring.handicap,
      scoring.black_confirmed_revision,
      scoring.white_confirmed_revision,
      scoring.finalized_at
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
    INTO latest_move
    FROM public.moves AS move
   WHERE move.game_id = NEW.game_id
   ORDER BY move.move_number DESC
   LIMIT 1
   FOR SHARE;

  SELECT move.move_number, move.color, move.is_pass, move.board_hash
    INTO prior_move
    FROM public.moves AS move
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
  SELECT
      game.status,
      game.phase,
      game.to_move,
      game.consecutive_passes,
      game.scoring_revision,
      game.rules,
      game.rules_profile,
      game.scoring_method,
      game.komi,
      game.handicap,
      EXISTS (
        SELECT 1
          FROM public.game_japanese_scoring_state AS scoring
         WHERE scoring.game_id = game.id
      ) AS has_japanese_scoring_state
    INTO lifecycle
    FROM public.games AS game
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
  -- resignation is independently authorized by the game service and must not
  -- be made dependent on fabricated resume evidence.
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

  SELECT
      scoring.revision,
      scoring.finalized_at,
      scoring.black_confirmed_revision,
      scoring.white_confirmed_revision,
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

-- Supersede migration 009's deletion guard. One confirmation remains immutable
-- except inside the exact authorized scoring-to-play transaction above.
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

REVOKE ALL ON FUNCTION public.guard_game_japanese_resume_authorization_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_game_japanese_resume_authorization_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_game_japanese_resume_authorization_commit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_game_japanese_resume_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_japanese_scoring_state_mutation() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.guard_game_japanese_resume_authorization_mutation(),
      public.validate_game_japanese_resume_authorization_insert(),
      public.validate_game_japanese_resume_authorization_commit(),
      public.guard_game_japanese_resume_transition(),
      public.guard_japanese_scoring_state_mutation() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.guard_game_japanese_resume_authorization_mutation(),
      public.validate_game_japanese_resume_authorization_insert(),
      public.validate_game_japanese_resume_authorization_commit(),
      public.guard_game_japanese_resume_transition(),
      public.guard_japanese_scoring_state_mutation() FROM authenticated;
  END IF;
END
$$;

DO $$
BEGIN
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
END
$$;

ALTER TABLE game_japanese_resume_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game_japanese_resume_authorizations FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON game_japanese_resume_authorizations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON game_japanese_resume_authorizations FROM authenticated;
  END IF;
END
$$;


-- Activate Japanese 1989 as a supported/default tuple while preserving all
-- historical Chinese tuples. Model output is optional proposal-only evidence.
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
    rules_profile IN ('legacy-immediate-area','chinese-2002-gostone-v1',
                      'japanese-1989-gostone-v1')
  ),
  ADD CONSTRAINT games_scoring_method_check CHECK (scoring_method IN ('area','territory')),
  ADD CONSTRAINT games_rules_check CHECK (rules IN ('chinese','japanese')),
  ADD CONSTRAINT games_finish_reason_check CHECK (
    finish_reason IN ('score','resignation','timeout','legacy_score',
                      'japanese_no_result','japanese_abandonment','japanese_repetition')
  );

ALTER TABLE matchmaking_queue
  ADD CONSTRAINT matchmaking_queue_rules_profile_compatibility_check CHECK (
    rules_profile IN ('legacy-immediate-area','chinese-2002-gostone-v1',
                      'japanese-1989-gostone-v1')
  );

ALTER TABLE game_japanese_scoring_state
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS black_participated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS white_participated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suggestion_status TEXT NOT NULL DEFAULT 'not_requested',
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
  IF EXISTS (SELECT 1 FROM game_japanese_scoring_state WHERE expires_at IS NULL) THEN
    RAISE EXCEPTION 'Japanese activation requires application-written scoring deadlines.';
  END IF;
END
$$;

ALTER TABLE game_japanese_scoring_state ALTER COLUMN expires_at SET NOT NULL;
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
  ADD CONSTRAINT game_japanese_scoring_suggestion_check CHECK (
    suggestion_status IN ('not_requested','ready','invalid')
    AND (
      (suggestion_status = 'not_requested'
       AND suggestion_request_identity IS NULL
       AND suggestion_provider_kind IS NULL
       AND suggestion_model_version IS NULL
       AND suggestion_error_class IS NULL)
      OR
      (suggestion_status = 'ready'
       AND suggestion_request_identity IS NOT NULL
       AND LENGTH(suggestion_request_identity) BETWEEN 3 AND 500
       AND suggestion_provider_kind IS NOT NULL
       AND LENGTH(suggestion_provider_kind) BETWEEN 1 AND 160
       AND suggestion_model_version IS NOT NULL
       AND LENGTH(suggestion_model_version) BETWEEN 1 AND 160
       AND suggestion_error_class IS NULL)
      OR
      (suggestion_status = 'invalid'
       AND suggestion_error_class IN ('invalid_suggestion','stale_suggestion'))
    )
  );

CREATE TABLE game_japanese_scoring_proposals (
  game_id UUID NOT NULL,
  scoring_revision INT NOT NULL CHECK (scoring_revision > 0),
  proposal_hash TEXT NOT NULL CHECK (proposal_hash ~ '^[0-9a-f]{64}$'),
  source TEXT NOT NULL CHECK (
    source IN ('manual_initial','model_initial','player_edit','undo','reset')
  ),
  actor_color TEXT CHECK (actor_color IN ('black','white')),
  parent_scoring_revision INT,
  dead_stones JSONB NOT NULL CHECK (jsonb_typeof(dead_stones) = 'array'),
  neutral_region_seeds JSONB NOT NULL CHECK (jsonb_typeof(neutral_region_seeds) = 'array'),
  stopped_move_number INT NOT NULL CHECK (stopped_move_number >= 2),
  stopped_board_hash TEXT NOT NULL CHECK (BTRIM(stopped_board_hash) <> ''),
  rules TEXT NOT NULL CHECK (rules = 'japanese'),
  rules_profile TEXT NOT NULL CHECK (rules_profile = 'japanese-1989-gostone-v1'),
  scoring_method TEXT NOT NULL CHECK (scoring_method = 'territory'),
  komi NUMERIC(4,1) NOT NULL CHECK (komi = 6.5),
  handicap INT NOT NULL CHECK (handicap = 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (game_id,scoring_revision),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id,parent_scoring_revision)
    REFERENCES game_japanese_scoring_proposals(game_id,scoring_revision),
  FOREIGN KEY (game_id,rules,rules_profile,scoring_method,komi,handicap)
    REFERENCES games(id,rules,rules_profile,scoring_method,komi,handicap)
    ON DELETE CASCADE,
  CHECK (
    (source = 'manual_initial' AND actor_color IS NULL AND parent_scoring_revision IS NULL)
    OR (source = 'model_initial' AND actor_color IS NULL AND parent_scoring_revision IS NOT NULL)
    OR (source IN ('player_edit','undo','reset')
        AND actor_color IS NOT NULL AND parent_scoring_revision IS NOT NULL)
  )
);

CREATE TABLE game_japanese_scoring_terminal_events (
  game_id UUID PRIMARY KEY,
  scoring_revision INT NOT NULL CHECK (scoring_revision > 0),
  stopped_move_number INT NOT NULL CHECK (stopped_move_number >= 2),
  stopped_board_hash TEXT NOT NULL CHECK (BTRIM(stopped_board_hash) <> ''),
  proposal_hash TEXT NOT NULL CHECK (proposal_hash ~ '^[0-9a-f]{64}$'),
  outcome_kind TEXT NOT NULL CHECK (
    outcome_kind IN ('no_participation','unresolved','abandonment')
  ),
  winner_color TEXT CHECK (winner_color IN ('black','white')),
  abandoned_by_color TEXT CHECK (abandoned_by_color IN ('black','white')),
  rules TEXT NOT NULL CHECK (rules = 'japanese'),
  rules_profile TEXT NOT NULL CHECK (rules_profile = 'japanese-1989-gostone-v1'),
  scoring_method TEXT NOT NULL CHECK (scoring_method = 'territory'),
  komi NUMERIC(4,1) NOT NULL CHECK (komi = 6.5),
  handicap INT NOT NULL CHECK (handicap = 0),
  captured_white_by_black_at_stop INT NOT NULL CHECK (captured_white_by_black_at_stop >= 0),
  captured_black_by_white_at_stop INT NOT NULL CHECK (captured_black_by_white_at_stop >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE RESTRICT,
  FOREIGN KEY (game_id,rules,rules_profile,scoring_method,komi,handicap)
    REFERENCES games(id,rules,rules_profile,scoring_method,komi,handicap),
  CHECK (
    (outcome_kind = 'abandonment' AND winner_color IS NOT NULL
     AND abandoned_by_color IS NOT NULL AND winner_color <> abandoned_by_color)
    OR
    (outcome_kind IN ('no_participation','unresolved')
     AND winner_color IS NULL AND abandoned_by_color IS NULL)
  )
);

-- The dormant foundation tied mutable child rows to the current digest. Edits
-- delete those rows before advancing the digest; keep the identity FK explicit.
ALTER TABLE game_japanese_dead_stones
  DROP CONSTRAINT IF EXISTS game_japanese_dead_stones_game_id_revision_proposal_hash_fkey;
ALTER TABLE game_japanese_dead_stones
  ADD CONSTRAINT game_japanese_dead_stones_state_fk
  FOREIGN KEY (game_id,revision,proposal_hash)
  REFERENCES game_japanese_scoring_state(game_id,revision,proposal_hash)
  ON DELETE CASCADE;

ALTER TABLE game_japanese_neutral_region_seeds
  DROP CONSTRAINT IF EXISTS game_japanese_neutral_region_seeds_game_id_revision_proposal_hash_fkey;
ALTER TABLE game_japanese_neutral_region_seeds
  ADD CONSTRAINT game_japanese_neutral_seeds_state_fk
  FOREIGN KEY (game_id,revision,proposal_hash)
  REFERENCES game_japanese_scoring_state(game_id,revision,proposal_hash)
  ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.guard_japanese_scoring_state_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE authorized_close BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.games AS game
       WHERE game.id = OLD.game_id
         AND (
           (game.status = 'active' AND game.phase = 'play'
            AND game.scoring_revision = OLD.revision + 1)
           OR
           (game.status = 'finished' AND game.to_move IS NULL)
         )
    ) INTO authorized_close;
    IF authorized_close THEN RETURN OLD; END IF;
    PERFORM 1 FROM public.games WHERE id = OLD.game_id;
    IF FOUND THEN
      RAISE EXCEPTION 'Japanese scoring closes only through resume or terminal evidence.'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.finalized_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Finalized Japanese scoring state is immutable.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.game_id IS DISTINCT FROM OLD.game_id
    OR NEW.board_hash IS DISTINCT FROM OLD.board_hash
    OR NEW.stopped_move_number IS DISTINCT FROM OLD.stopped_move_number
    OR NEW.rules IS DISTINCT FROM OLD.rules
    OR NEW.rules_profile IS DISTINCT FROM OLD.rules_profile
    OR NEW.scoring_method IS DISTINCT FROM OLD.scoring_method
    OR NEW.komi IS DISTINCT FROM OLD.komi
    OR NEW.handicap IS DISTINCT FROM OLD.handicap
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.captured_white_by_black_at_stop IS DISTINCT FROM OLD.captured_white_by_black_at_stop
    OR NEW.captured_black_by_white_at_stop IS DISTINCT FROM OLD.captured_black_by_white_at_stop
  THEN
    RAISE EXCEPTION 'A stopped Japanese scoring identity is immutable.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.revision IS DISTINCT FROM OLD.revision THEN
    IF NEW.revision <> OLD.revision + 1
      OR NEW.proposal_hash IS NOT DISTINCT FROM OLD.proposal_hash
      OR NEW.black_confirmed_revision IS NOT NULL
      OR NEW.white_confirmed_revision IS NOT NULL
      OR NEW.black_confirmed_proposal_hash IS NOT NULL
      OR NEW.white_confirmed_proposal_hash IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.games AS game
         WHERE game.id = OLD.game_id AND game.scoring_revision = NEW.revision
      )
    THEN
      RAISE EXCEPTION 'Proposal edits require one new revision and cleared confirmations.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.proposal_hash IS DISTINCT FROM OLD.proposal_hash THEN
    RAISE EXCEPTION 'A proposal digest changes only with its revision.'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.black_participated_at IS NOT NULL
    AND NEW.black_participated_at IS DISTINCT FROM OLD.black_participated_at
  THEN RAISE EXCEPTION 'Participation evidence is monotonic.' USING ERRCODE = '23514'; END IF;
  IF OLD.white_participated_at IS NOT NULL
    AND NEW.white_participated_at IS DISTINCT FROM OLD.white_participated_at
  THEN RAISE EXCEPTION 'Participation evidence is monotonic.' USING ERRCODE = '23514'; END IF;
  IF OLD.suggestion_status = 'ready' AND (
    NEW.suggestion_status IS DISTINCT FROM OLD.suggestion_status
    OR NEW.suggestion_request_identity IS DISTINCT FROM OLD.suggestion_request_identity
    OR NEW.suggestion_provider_kind IS DISTINCT FROM OLD.suggestion_provider_kind
    OR NEW.suggestion_model_version IS DISTINCT FROM OLD.suggestion_model_version
  ) THEN
    RAISE EXCEPTION 'Accepted model identity evidence is immutable.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_japanese_scoring_evidence_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE state_row RECORD; game_revision INT;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Japanese scoring evidence cannot be truncated.'
      USING ERRCODE = '23514';
  END IF;
  SELECT scoring.*, game.scoring_revision AS game_revision
    INTO state_row
    FROM public.game_japanese_scoring_state AS scoring
    JOIN public.games AS game ON game.id = scoring.game_id
   WHERE scoring.game_id = COALESCE(NEW.game_id,OLD.game_id)
   FOR UPDATE OF scoring;
  IF FOUND AND (
    state_row.finalized_at IS NOT NULL
    OR (
      (state_row.black_confirmed_revision IS NOT NULL
       OR state_row.white_confirmed_revision IS NOT NULL)
      AND state_row.game_revision = state_row.revision
    )
  ) THEN
    RAISE EXCEPTION 'Confirmed Japanese scoring evidence is immutable.'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_japanese_append_only_evidence()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM public.games WHERE id = OLD.game_id;
    IF NOT FOUND THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'Japanese lifecycle evidence is append-only.' USING ERRCODE = '23514';
END
$$;

DROP TRIGGER IF EXISTS game_japanese_scoring_state_mutation_guard
  ON game_japanese_scoring_state;
DROP TRIGGER IF EXISTS game_japanese_dead_stones_mutation_guard
  ON game_japanese_dead_stones;
DROP TRIGGER IF EXISTS game_japanese_neutral_seeds_mutation_guard
  ON game_japanese_neutral_region_seeds;

CREATE TRIGGER game_japanese_scoring_state_mutation_guard
  BEFORE UPDATE OR DELETE ON game_japanese_scoring_state
  FOR EACH ROW EXECUTE FUNCTION public.guard_japanese_scoring_state_mutation();
CREATE TRIGGER game_japanese_dead_stones_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON game_japanese_dead_stones
  FOR EACH ROW EXECUTE FUNCTION public.guard_japanese_scoring_evidence_mutation();
CREATE TRIGGER game_japanese_neutral_seeds_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON game_japanese_neutral_region_seeds
  FOR EACH ROW EXECUTE FUNCTION public.guard_japanese_scoring_evidence_mutation();
CREATE TRIGGER game_japanese_scoring_proposals_immutable_guard
  BEFORE UPDATE OR DELETE ON game_japanese_scoring_proposals
  FOR EACH ROW EXECUTE FUNCTION public.guard_japanese_append_only_evidence();
CREATE TRIGGER game_japanese_scoring_terminal_immutable_guard
  BEFORE UPDATE OR DELETE ON game_japanese_scoring_terminal_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_japanese_append_only_evidence();

ALTER TABLE game_japanese_scoring_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_japanese_scoring_terminal_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game_japanese_scoring_proposals,game_japanese_scoring_terminal_events FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_japanese_scoring_state_mutation(),
  public.guard_japanese_scoring_evidence_mutation(),
  public.guard_japanese_append_only_evidence() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON game_japanese_scoring_proposals,game_japanese_scoring_terminal_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON game_japanese_scoring_proposals,game_japanese_scoring_terminal_events
      FROM authenticated;
  END IF;
END
$$;

-- The migration runner owns the surrounding transaction. Keep lock waits
-- bounded so replacing the live games constraint fails safely under load.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_finish_reason_check;
ALTER TABLE games
  ADD CONSTRAINT games_finish_reason_check CHECK (
    finish_reason IN (
      'score', 'resignation', 'timeout', 'legacy_score',
      'japanese_no_result', 'japanese_abandonment',
      'japanese_repetition'
    )
  );

CREATE TABLE game_japanese_repetition_claims (
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
    REFERENCES moves(game_id, move_number) ON DELETE RESTRICT,
  CONSTRAINT game_japanese_repetition_claims_game_rules_fk
    FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)
    REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)
    ON DELETE RESTRICT
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
