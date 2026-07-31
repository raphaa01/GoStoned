-- Persist only the immutable authority needed to resume a stopped Japanese
-- game. Japanese play remains dormant: this migration adds no application
-- route, service write, matchmaking profile, or production rules activation.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS game_japanese_resume_authorizations (
  game_id UUID NOT NULL,
  stopped_move_number INT NOT NULL,
  stopped_board_hash TEXT NOT NULL,
  requested_by_color TEXT NOT NULL,
  rules TEXT NOT NULL,
  rules_profile TEXT NOT NULL,
  scoring_method TEXT NOT NULL,
  komi NUMERIC(4,1) NOT NULL,
  handicap INT NOT NULL,
  CONSTRAINT game_japanese_resume_authorizations_pkey
    PRIMARY KEY (game_id, stopped_move_number),
  CONSTRAINT game_japanese_resume_authorizations_game_fk
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
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

-- The referenced exact-rules unique key was installed by migration 009. Keep
-- this upgrade constraint idempotent and relation-scoped so an unrelated
-- constraint with the same name cannot suppress it.
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
BEGIN
  -- Lock the game first. Every Japanese resume writer must use this order so
  -- concurrent move, scoring, and resume attempts serialize on one parent.
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

  -- Lock the scoring row only after its game row. Its proposal revision is
  -- mutable materialization state and therefore is validated, not persisted.
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
    OR NEW.stopped_board_hash IS DISTINCT FROM scoring_snapshot.board_hash
    OR NEW.stopped_move_number IS DISTINCT FROM scoring_snapshot.stopped_move_number
    OR NEW.rules IS DISTINCT FROM scoring_snapshot.rules
    OR NEW.rules_profile IS DISTINCT FROM scoring_snapshot.rules_profile
    OR NEW.scoring_method IS DISTINCT FROM scoring_snapshot.scoring_method
    OR NEW.komi IS DISTINCT FROM scoring_snapshot.komi
    OR NEW.handicap IS DISTINCT FROM scoring_snapshot.handicap
  THEN
    RAISE EXCEPTION 'Japanese resume authorization must match the live unfinalized scoring state.'
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
      authorization.requested_by_color
    INTO resume_snapshot
    FROM public.game_japanese_scoring_state AS scoring
    JOIN public.game_japanese_resume_authorizations AS authorization
      ON authorization.game_id = scoring.game_id
     AND authorization.stopped_move_number = scoring.stopped_move_number
     AND authorization.stopped_board_hash = scoring.board_hash
     AND authorization.rules = scoring.rules
     AND authorization.rules_profile = scoring.rules_profile
     AND authorization.scoring_method = scoring.scoring_method
     AND authorization.komi = scoring.komi
     AND authorization.handicap = scoring.handicap
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

REVOKE ALL ON FUNCTION public.guard_game_japanese_resume_authorization_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_game_japanese_resume_authorization_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_game_japanese_resume_authorization_commit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_game_japanese_resume_transition() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.guard_game_japanese_resume_authorization_mutation(),
      public.validate_game_japanese_resume_authorization_insert(),
      public.validate_game_japanese_resume_authorization_commit(),
      public.guard_game_japanese_resume_transition() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.guard_game_japanese_resume_authorization_mutation(),
      public.validate_game_japanese_resume_authorization_insert(),
      public.validate_game_japanese_resume_authorization_commit(),
      public.guard_game_japanese_resume_transition() FROM authenticated;
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
