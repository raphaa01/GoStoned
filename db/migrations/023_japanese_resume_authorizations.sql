-- Persist the minimum immutable authority needed to resume a stopped Japanese
-- game. Japanese play remains dormant: this migration adds no application
-- route, service write, matchmaking profile, or production rules activation.

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
  IF NOT (
    OLD.rules = 'japanese'
    AND OLD.rules_profile = 'japanese-1989-gostone-v1'
    AND OLD.scoring_method = 'territory'
    AND OLD.komi = 6.5
    AND OLD.handicap = 0
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
