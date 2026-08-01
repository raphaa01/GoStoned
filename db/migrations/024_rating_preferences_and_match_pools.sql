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
        AND rules_snapshot = 'chinese'
        AND LENGTH(rules_version_snapshot) BETWEEN 1 AND 120
        AND scoring_method_snapshot = 'area'
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
