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
