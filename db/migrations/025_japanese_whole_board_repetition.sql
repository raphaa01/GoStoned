-- The migration runner owns the surrounding transaction. Keep lock waits
-- bounded so replacing the live games constraint fails safely under load.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_finish_reason_check;
ALTER TABLE games
  ADD CONSTRAINT games_finish_reason_check CHECK (
    finish_reason IN (
      'score', 'resignation', 'timeout', 'legacy_score',
      'japanese_adjudication', 'japanese_no_result', 'japanese_abandonment',
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
