SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'game_scoring_resume_events_game_rules_fk'
       AND conrelid = 'public.game_scoring_resume_events'::regclass
  ) THEN
    ALTER TABLE game_scoring_resume_events
      ADD CONSTRAINT game_scoring_resume_events_game_rules_fk
      FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)
      REFERENCES games (id, rules, rules_profile, scoring_method, komi, handicap)
      ON DELETE CASCADE;
  END IF;
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

REVOKE ALL ON FUNCTION public.guard_game_scoring_resume_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_game_scoring_resume_event_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_game_scoring_resume_event_commit() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.guard_game_scoring_resume_event_mutation(),
      public.validate_game_scoring_resume_event_insert(),
      public.validate_game_scoring_resume_event_commit() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.guard_game_scoring_resume_event_mutation(),
      public.validate_game_scoring_resume_event_insert(),
      public.validate_game_scoring_resume_event_commit() FROM authenticated;
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
END
$$;

ALTER TABLE game_scoring_resume_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game_scoring_resume_events FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON game_scoring_resume_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON game_scoring_resume_events FROM authenticated;
  END IF;
END
$$;
