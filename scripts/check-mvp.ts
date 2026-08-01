import "dotenv/config";
import { closePool, query } from "../lib/db";
import { isLocalDatabase } from "../lib/env";
import { getLegalNotice } from "../lib/legal";

const requiredVariables = [
  "DATABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "APPLE_CLIENT_ID",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY",
  "LEGAL_OPERATOR_TYPE",
  "LEGAL_NAME",
  "LEGAL_STREET",
  "LEGAL_CITY",
  "LEGAL_EMAIL",
] as const;

const requiredTables = [
  "schema_migrations",
  "users",
  "auth_identities",
  "user_sessions",
  "guest_sessions",
  "auth_rate_limits",
  "games",
  "moves",
  "matchmaking_queue",
  "game_messages",
  "player_blocks",
  "player_reports",
  "player_stats",
  "player_rating_history",
  "player_glicko2_ratings",
  "game_glicko2_rating_events",
  "player_rating_preferences",
  "player_initial_rating_claims",
  "calibrated_bot_profiles",
  "calibrated_bot_profile_configurations",
  "calibrated_bot_profile_activation_events",
  "game_calibrated_bot_bindings",
  "game_calibrated_bot_actions",
  "game_scoring_state",
  "game_dead_stones",
  "game_scoring_resume_events",
  "game_japanese_scoring_state",
  "game_japanese_dead_stones",
  "game_japanese_neutral_region_seeds",
  "game_analysis_jobs",
  "katago_workers",
  "game_bots",
  "puzzles",
  "puzzle_generation_jobs",
  "puzzle_attempts",
] as const;

const requiredGameColumns = [
  "phase",
  "to_move",
  "consecutive_passes",
  "scoring_revision",
  "rules_profile",
  "scoring_method",
  "handicap",
  "finish_reason",
  "last_resume_claim",
  "last_resume_by",
  "last_resume_x",
  "last_resume_y",
] as const;

const requiredScoringColumns = [
  "board_hash",
  "revision",
  "rules_profile",
  "fallback_to_move",
  "expires_at",
  "black_confirmed_revision",
  "white_confirmed_revision",
  "finalized_at",
] as const;

const requiredQueueColumns = [
  "rules_profile", "matchmaking_policy_version", "match_pool", "rules_snapshot",
  "rules_version_snapshot", "scoring_method_snapshot", "komi_snapshot",
  "handicap_snapshot", "rating_snapshot", "rating_deviation_snapshot",
  "rating_algorithm_version", "rating_state_updated_at", "preference_revision",
  "display_preference_snapshot", "bot_match_preference", "abandonment_risk",
  "abandonment_policy_version", "abandonment_evaluated_at", "handicap_preference",
  "bot_fallback_not_before",
] as const;

const requiredJapaneseScoringColumns = [
  "proposal_hash",
  "black_confirmed_proposal_hash",
  "white_confirmed_proposal_hash",
  "scored_proposal_hash",
] as const;

const requiredResumeEventColumns = [
  "game_id",
  "scoring_revision",
  "board_hash",
  "stopped_move_number",
  "rules",
  "rules_profile",
  "scoring_method",
  "komi",
  "handicap",
  "fallback_to_move",
  "scoring_expires_at",
  "resume_claim",
  "requested_by_color",
  "disputed_x",
  "disputed_y",
  "resumed_to_move",
  "resumed_at",
] as const;

const requiredIndexDefinitions = {
  idx_user_sessions_expires_at: [
    "ON public.user_sessions USING btree (expires_at)",
  ],
  idx_matchmaking_waiting_pool_updated_at: [
    "ON public.matchmaking_queue USING btree (board_size, time_control, rules_profile, updated_at, player_key)",
    "WHERE (status = 'waiting'::text)",
  ],
  idx_player_rating_history_board_player_time: [
    "ON public.player_rating_history USING btree (board_size, player_key, recorded_at, id)",
    "INCLUDE (game_id, rating_before, rating_after, result)",
  ],
  idx_game_glicko2_events_player_period: [
    "ON public.game_glicko2_rating_events USING btree (player_key, rating_period_at DESC, game_id)",
  ],
  idx_matchmaking_adaptive_waiting: [
    "ON public.matchmaking_queue USING btree (matchmaking_policy_version, match_pool, board_size, time_control, rules_profile, created_at, player_key)",
    "WHERE (status = 'waiting'::text)",
  ],
  idx_calibrated_bot_action_move_once: [
    "ON public.game_calibrated_bot_actions USING btree (game_id, move_number)",
    "WHERE (action_kind = ANY",
  ],
  idx_calibrated_bot_action_resign_once: [
    "ON public.game_calibrated_bot_actions USING btree (game_id)",
    "WHERE (action_kind = 'resign'::text)",
  ],
  idx_player_blocks_blocked_blocker: [
    "ON public.player_blocks USING btree (blocked_key, blocker_key)",
  ],
  idx_player_blocks_guest_retention: [
    "ON public.player_blocks USING btree (created_at, blocker_key, blocked_key)",
    "WHERE",
    "guest:%",
  ],
  idx_player_reports_reported_created: [
    "ON public.player_reports USING btree (reported_key, created_at DESC, game_id, reporter_key)",
  ],
  idx_game_analysis_jobs_claim: [
    "ON public.game_analysis_jobs USING btree (status, created_at, id)",
    "WHERE (status = ANY",
  ],
  idx_game_analysis_jobs_game: [
    "ON public.game_analysis_jobs USING btree (game_id, game_version DESC)",
  ],
  idx_katago_workers_ready: [
    "ON public.katago_workers USING btree (last_seen_at DESC)",
    "WHERE ready",
  ],
  idx_game_bots_claim: [
    "ON public.game_bots USING btree (next_move_at, game_id)",
    "WHERE (lease_expires_at IS NULL)",
  ],
  idx_puzzles_daily_date: [
    "ON public.puzzles USING btree (daily_date)",
    "WHERE (kind = 'daily'::text)",
  ],
  idx_puzzles_practice_published: [
    "ON public.puzzles USING btree (published_at DESC, id)",
    "WHERE (kind = 'practice'::text)",
  ],
  idx_puzzle_jobs_daily_target: [
    "ON public.puzzle_generation_jobs USING btree (target_date)",
    "WHERE (kind = 'daily'::text)",
  ],
  idx_puzzle_generation_jobs_claim: [
    "ON public.puzzle_generation_jobs USING btree (status, created_at, id)",
    "WHERE (status = ANY",
  ],
  idx_puzzle_attempts_player: [
    "ON public.puzzle_attempts USING btree (player_key, last_attempt_at DESC)",
  ],
  idx_puzzles_category_order: [
    "ON public.puzzles USING btree (category, collection_order)",
    "WHERE ((kind = 'practice'::text) AND (category IS NOT NULL))",
  ],
  idx_puzzle_jobs_category_order: [
    "ON public.puzzle_generation_jobs USING btree (category, collection_order)",
    "WHERE ((kind = 'practice'::text) AND (category IS NOT NULL))",
  ],
  idx_puzzles_category_catalog: [
    "ON public.puzzles USING btree (category, collection_order, id)",
    "WHERE ((kind = 'practice'::text) AND (category IS NOT NULL))",
  ],
} as const;

const requiredConstraintSignatures = [
  "games_rules_identity_unique:games:u",
  "games_supported_rules_tuple_check:games:c",
  "game_scoring_state_game_rules_fk:game_scoring_state:f",
  "game_japanese_scoring_game_rules_fk:game_japanese_scoring_state:f",
  "game_scoring_resume_events_pkey:game_scoring_resume_events:p",
  "game_scoring_resume_events_claim_shape_check:game_scoring_resume_events:c",
  "game_scoring_resume_events_game_rules_fk:game_scoring_resume_events:f",
  "matchmaking_queue_rules_profile_compatibility_check:matchmaking_queue:c",
  "player_blocks_pkey:player_blocks:p",
  "player_blocks_distinct_players_check:player_blocks:c",
  "player_blocks_key_bounds_check:player_blocks:c",
  "player_reports_pkey:player_reports:p",
  "player_reports_game_fk:player_reports:f",
  "player_reports_distinct_players_check:player_reports:c",
  "player_reports_key_bounds_check:player_reports:c",
  "player_reports_category_check:player_reports:c",
  "puzzles_category_shape_check:puzzles:c",
  "puzzle_generation_jobs_category_shape_check:puzzle_generation_jobs:c",
  "puzzle_attempts_variation_progress_check:puzzle_attempts:c",
  "player_rating_history_algorithm_check:player_rating_history:c",
  "player_glicko2_ratings_pkey:player_glicko2_ratings:p",
  "player_glicko2_ratings_user_id_key:player_glicko2_ratings:u",
  "player_glicko2_ratings_user_fk:player_glicko2_ratings:f",
  "player_glicko2_ratings_algorithm_check:player_glicko2_ratings:c",
  "game_glicko2_rating_events_pkey:game_glicko2_rating_events:p",
  "game_glicko2_rating_events_game_fk:game_glicko2_rating_events:f",
  "game_glicko2_rating_events_player_fk:game_glicko2_rating_events:f",
  "game_glicko2_rating_events_outcome_check:game_glicko2_rating_events:c",
  "game_glicko2_rating_events_algorithm_check:game_glicko2_rating_events:c",
  "player_rating_preferences_pkey:player_rating_preferences:p",
  "player_initial_rating_claims_pkey:player_initial_rating_claims:p",
  "matchmaking_queue_adaptive_state_check:matchmaking_queue:c",
  "calibrated_bot_profiles_pkey:calibrated_bot_profiles:p",
  "calibrated_bot_profile_configurations_pkey:calibrated_bot_profile_configurations:p",
  "calibrated_bot_profile_activation_events_pkey:calibrated_bot_profile_activation_events:p",
  "game_calibrated_bot_bindings_pkey:game_calibrated_bot_bindings:p",
  "game_calibrated_bot_actions_pkey:game_calibrated_bot_actions:p",
] as const;

const requiredRolloutConstraintSignatures = [
  "moves_board_hash_required_check:moves:c",
] as const;

const requiredConstraintDefinitions = {
  moves_board_hash_required_check: {
    includes: ["CHECK ((board_hash IS NOT NULL))"],
    excludes: [],
  },
  games_rules_identity_unique: {
    includes: [
      "UNIQUE (id, rules, rules_profile, scoring_method, komi, handicap)",
    ],
    excludes: [],
  },
  games_supported_rules_tuple_check: {
    includes: [
      "legacy-immediate-area",
      "chinese-2002-gostone-v1",
      "japanese-1989-gostone-v1",
      "chinese",
      "japanese",
      "area",
      "territory",
      "6.5",
      "7.5",
    ],
    excludes: [],
  },
  game_scoring_state_game_rules_fk: {
    includes: [
      "FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)",
      "REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)",
      "ON DELETE CASCADE",
    ],
    excludes: [],
  },
  game_japanese_scoring_game_rules_fk: {
    includes: [
      "FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)",
      "REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)",
      "ON DELETE CASCADE",
    ],
    excludes: [],
  },
  game_scoring_resume_events_pkey: {
    includes: ["PRIMARY KEY (game_id, scoring_revision)"],
    excludes: [],
  },
  game_scoring_resume_events_claim_shape_check: {
    includes: [
      "resume_claim = 'dead'::text",
      "resume_claim = 'alive'::text",
      "resume_claim = 'deadline'::text",
      "resumed_to_move = requested_by_color",
      "resumed_to_move <> requested_by_color",
      "resumed_at < scoring_expires_at",
      "resumed_to_move = fallback_to_move",
      "scoring_expires_at <= resumed_at",
    ],
    excludes: [],
  },
  game_scoring_resume_events_game_rules_fk: {
    includes: [
      "FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)",
      "REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)",
      "ON DELETE CASCADE",
    ],
    excludes: [],
  },
  matchmaking_queue_rules_profile_compatibility_check: {
    includes: ["legacy-immediate-area", "chinese-2002-gostone-v1"],
    excludes: ["japanese-1989-gostone-v1"],
  },
  player_blocks_pkey: {
    includes: ["PRIMARY KEY (blocker_key, blocked_key)"],
    excludes: [],
  },
  player_blocks_distinct_players_check: {
    includes: ["CHECK ((blocker_key <> blocked_key))"],
    excludes: [],
  },
  player_blocks_key_bounds_check: {
    includes: ["user|guest", "blocker_key", "blocked_key"],
    excludes: [],
  },
  player_reports_pkey: {
    includes: ["PRIMARY KEY (game_id, reporter_key)"],
    excludes: [],
  },
  player_reports_game_fk: {
    includes: ["FOREIGN KEY (game_id)", "REFERENCES games(id)", "ON DELETE RESTRICT"],
    excludes: ["ON DELETE CASCADE"],
  },
  player_reports_distinct_players_check: {
    includes: ["CHECK ((reporter_key <> reported_key))"],
    excludes: [],
  },
  player_reports_key_bounds_check: {
    includes: ["user|guest", "reporter_key", "reported_key"],
    excludes: [],
  },
  player_reports_category_check: {
    includes: [
      "abuse_or_hate",
      "threat_or_sexual_safety",
      "fair_play",
      "stalling_or_abandonment",
      "spam_scam_or_identity",
      "other",
    ],
    excludes: [],
  },
  puzzles_category_shape_check: {
    includes: [
      "life_and_death",
      "tesuji",
      "capturing_race",
      "endgame",
      "rank_kyu >= 1",
      "rank_kyu <= 30",
      "collection_order >= 1",
      "collection_order <= 10",
      "jsonb_typeof(variation) = 'object'::text",
      "mainLine",
      "refutations",
    ],
    excludes: [],
  },
  puzzle_generation_jobs_category_shape_check: {
    includes: [
      "life_and_death",
      "tesuji",
      "capturing_race",
      "endgame",
      "target_date IS NULL",
      "rank_kyu >= 1",
      "rank_kyu <= 30",
      "collection_order >= 1",
      "collection_order <= 10",
    ],
    excludes: [],
  },
  puzzle_attempts_variation_progress_check: {
    includes: [
      "jsonb_typeof(variation_progress) = 'array'::text",
      "jsonb_array_length(variation_progress) <= 12",
      "variation_revision >= 0",
      "variation_revision <= 1000",
    ],
    excludes: [],
  },
  player_rating_history_algorithm_check: {
    includes: ["fixed-elo-legacy-v1"],
    excludes: [],
  },
  player_glicko2_ratings_user_fk: {
    includes: ["FOREIGN KEY (user_id)", "REFERENCES users(id)", "ON DELETE CASCADE"],
    excludes: [],
  },
  player_glicko2_ratings_algorithm_check: {
    includes: ["glicko2-v1-tau-0.5"],
    excludes: [],
  },
  game_glicko2_rating_events_game_fk: {
    includes: ["FOREIGN KEY (game_id)", "REFERENCES games(id)", "ON DELETE RESTRICT"],
    excludes: ["ON DELETE CASCADE"],
  },
  game_glicko2_rating_events_player_fk: {
    includes: ["FOREIGN KEY (player_key)", "REFERENCES player_glicko2_ratings(player_key)", "ON DELETE RESTRICT"],
    excludes: ["ON DELETE CASCADE"],
  },
  game_glicko2_rating_events_outcome_check: {
    includes: ["no_result", "rated_game_count_after = rated_game_count_before", "rated_game_count_after = (rated_game_count_before + 1)"],
    excludes: [],
  },
  game_glicko2_rating_events_algorithm_check: {
    includes: ["glicko2-v1-tau-0.5"],
    excludes: [],
  },
  matchmaking_queue_adaptive_state_check: {
    includes: ["adaptive-global-glicko-match-v1", "registered-rated", "guest-unrated", "glicko2-v1-tau-0.5"],
    excludes: [],
  },
} as const;

const requiredTriggerSignatures = [
  "matchmaking_rules_profile_guard:matchmaking_queue:public:enforce_matchmaking_rules_profile:23",
  "game_rules_identity_mutation_guard:games:public:guard_game_rules_identity_mutation:19",
  "game_scoring_resume_events_insert_guard:game_scoring_resume_events:public:validate_game_scoring_resume_event_insert:7",
  "game_scoring_resume_events_commit_guard:game_scoring_resume_events:public:validate_game_scoring_resume_event_commit:5",
  "game_scoring_resume_events_immutable_guard:game_scoring_resume_events:public:guard_game_scoring_resume_event_mutation:27",
  "game_scoring_resume_events_truncate_guard:game_scoring_resume_events:public:guard_game_scoring_resume_event_mutation:34",
  "game_japanese_scoring_state_mutation_guard:game_japanese_scoring_state:public:guard_japanese_scoring_state_mutation:27",
  "game_japanese_dead_stones_mutation_guard:game_japanese_dead_stones:public:guard_japanese_scoring_evidence_mutation:31",
  "game_japanese_neutral_seeds_mutation_guard:game_japanese_neutral_region_seeds:public:guard_japanese_scoring_evidence_mutation:31",
  "game_glicko2_rating_events_insert_guard:game_glicko2_rating_events:public:validate_glicko2_rating_event_insert:7",
  "game_glicko2_rating_events_commit_guard:game_glicko2_rating_events:public:validate_glicko2_rating_event_commit:5",
  "game_glicko2_rating_events_immutable_guard:game_glicko2_rating_events:public:guard_glicko2_rating_event_mutation:27",
  "game_glicko2_rating_events_truncate_guard:game_glicko2_rating_events:public:guard_glicko2_rating_event_mutation:34",
  "player_initial_rating_claims_insert_guard:player_initial_rating_claims:public:validate_initial_rating_claim_insert:7",
  "player_initial_rating_claims_immutable_guard:player_initial_rating_claims:public:guard_initial_rating_claim_mutation:27",
  "player_initial_rating_claims_truncate_guard:player_initial_rating_claims:public:guard_initial_rating_claim_mutation:34",
  "player_rating_preferences_update_guard:player_rating_preferences:public:guard_rating_preference_update:19",
  "calibrated_bot_activation_insert_guard:calibrated_bot_profile_activation_events:public:validate_calibrated_bot_activation:7",
  "calibrated_bot_binding_insert_guard:game_calibrated_bot_bindings:public:validate_calibrated_bot_binding:7",
  "calibrated_bot_action_insert_guard:game_calibrated_bot_actions:public:validate_calibrated_bot_action_insert:7",
  "bound_game_bot_identity_guard:game_bots:public:guard_bound_game_bot_identity:19",
  "game_glicko2_calibrated_bot_event_insert_guard:game_glicko2_rating_events:public:validate_calibrated_bot_rating_event_insert:7",
  "game_glicko2_calibrated_bot_event_commit_guard:game_glicko2_rating_events:public:validate_calibrated_bot_rating_event_commit:5",
  "player_glicko2_ratings_transition_guard:player_glicko2_ratings:public:validate_glicko2_state_transition:19",
] as const;

const requiredTriggerDefinitions = {
  matchmaking_rules_profile_guard:
    "UPDATE OF status, game_id, rules_profile",
  game_rules_identity_mutation_guard:
    "UPDATE OF rules, rules_profile, scoring_method, komi, handicap",
  game_scoring_resume_events_insert_guard:
    "BEFORE INSERT ON public.game_scoring_resume_events",
  game_scoring_resume_events_commit_guard:
    "AFTER INSERT ON public.game_scoring_resume_events DEFERRABLE INITIALLY DEFERRED",
  game_scoring_resume_events_immutable_guard:
    "BEFORE DELETE OR UPDATE ON public.game_scoring_resume_events",
  game_scoring_resume_events_truncate_guard:
    "BEFORE TRUNCATE ON public.game_scoring_resume_events",
  game_glicko2_rating_events_insert_guard:
    "BEFORE INSERT ON public.game_glicko2_rating_events",
  game_glicko2_rating_events_commit_guard:
    "AFTER INSERT ON public.game_glicko2_rating_events DEFERRABLE INITIALLY DEFERRED",
  game_glicko2_rating_events_immutable_guard:
    "BEFORE DELETE OR UPDATE ON public.game_glicko2_rating_events",
  game_glicko2_rating_events_truncate_guard:
    "BEFORE TRUNCATE ON public.game_glicko2_rating_events",
  player_initial_rating_claims_insert_guard:
    "BEFORE INSERT ON public.player_initial_rating_claims",
  player_initial_rating_claims_immutable_guard:
    "BEFORE DELETE OR UPDATE ON public.player_initial_rating_claims",
  player_initial_rating_claims_truncate_guard:
    "BEFORE TRUNCATE ON public.player_initial_rating_claims",
  player_rating_preferences_update_guard:
    "BEFORE UPDATE ON public.player_rating_preferences",
  calibrated_bot_activation_insert_guard:
    "BEFORE INSERT ON public.calibrated_bot_profile_activation_events",
  calibrated_bot_binding_insert_guard:
    "BEFORE INSERT ON public.game_calibrated_bot_bindings",
  calibrated_bot_action_insert_guard:
    "BEFORE INSERT ON public.game_calibrated_bot_actions",
  bound_game_bot_identity_guard:
    "BEFORE UPDATE ON public.game_bots",
  game_glicko2_calibrated_bot_event_insert_guard:
    "BEFORE INSERT ON public.game_glicko2_rating_events",
  game_glicko2_calibrated_bot_event_commit_guard:
    "AFTER INSERT ON public.game_glicko2_rating_events DEFERRABLE INITIALLY DEFERRED",
  player_glicko2_ratings_transition_guard:
    "BEFORE UPDATE ON public.player_glicko2_ratings",
} as const;

const requiredProtectedTables = [
  "users",
  "user_sessions",
  "auth_identities",
  "player_blocks",
  "player_reports",
  "game_scoring_resume_events",
  "game_japanese_scoring_state",
  "game_japanese_dead_stones",
  "game_japanese_neutral_region_seeds",
  "game_analysis_jobs",
  "katago_workers",
  "game_bots",
  "puzzles",
  "puzzle_generation_jobs",
  "puzzle_attempts",
  "player_glicko2_ratings",
  "game_glicko2_rating_events",
  "player_rating_preferences",
  "player_initial_rating_claims",
  "calibrated_bot_profiles",
  "calibrated_bot_profile_configurations",
  "calibrated_bot_profile_activation_events",
  "game_calibrated_bot_bindings",
  "game_calibrated_bot_actions",
] as const;

const requiredGuardFunctions = [
  "public.enforce_matchmaking_rules_profile()",
  "public.guard_game_rules_identity_mutation()",
  "public.validate_game_scoring_resume_event_insert()",
  "public.validate_game_scoring_resume_event_commit()",
  "public.guard_game_scoring_resume_event_mutation()",
  "public.guard_japanese_scoring_state_mutation()",
  "public.guard_japanese_scoring_evidence_mutation()",
  "public.guard_glicko2_rating_event_mutation()",
  "public.validate_glicko2_rating_event_insert()",
  "public.validate_glicko2_rating_event_commit()",
  "public.guard_initial_rating_claim_mutation()",
  "public.validate_initial_rating_claim_insert()",
  "public.guard_rating_preference_update()",
  "public.guard_calibrated_bot_evidence_mutation()",
  "public.validate_calibrated_bot_activation()",
  "public.validate_calibrated_bot_binding()",
  "public.validate_calibrated_bot_action_insert()",
  "public.guard_bound_game_bot_identity()",
  "public.validate_calibrated_bot_rating_event_insert()",
  "public.validate_calibrated_bot_rating_event_commit()",
  "public.validate_glicko2_state_transition()",
] as const;

const requiredGuardFunctionDefinitions = {
  "public.validate_game_scoring_resume_event_insert()": [
    "FOR SHARE OF game, scoring",
    "NEW.scoring_revision IS DISTINCT FROM snapshot.snapshot_revision",
    "FROM public.game_dead_stones AS dead_stone",
  ],
  "public.validate_game_scoring_resume_event_commit()": [
    "lifecycle.scoring_revision IS DISTINCT FROM NEW.scoring_revision + 1",
    "lifecycle.last_resume_claim IS DISTINCT FROM NEW.resume_claim",
    "lifecycle.has_scoring_state",
  ],
  "public.guard_game_scoring_resume_event_mutation()": [
    "TG_OP = 'TRUNCATE'",
    "PERFORM 1 FROM public.games WHERE id = OLD.game_id",
    "Game scoring resume evidence is append-only.",
  ],
  "public.guard_glicko2_rating_event_mutation()": [
    "Glicko-2 game rating evidence is append-only.",
    "TG_OP = 'DELETE'",
  ],
  "public.validate_glicko2_rating_event_insert()": [
    "FROM public.games WHERE id = NEW.game_id FOR UPDATE",
    "registered-human terminal game",
    "locked global states",
  ],
  "public.validate_glicko2_rating_event_commit()": [
    "event_count <> 2",
    "complete paired state transition",
    "player_state.rating IS DISTINCT FROM NEW.rating_after",
  ],
  "public.guard_rating_preference_update()": [
    "NEW.preference_revision <> OLD.preference_revision + 1",
    "NEW.updated_at <= OLD.updated_at",
  ],
  "public.validate_calibrated_bot_binding()": [
    "queue_row.bot_match_preference <> 'calibrated-rated-after-wait'",
    "config_row.rules_version <> queue_row.rules_version_snapshot",
    "fixed_rating_deviation IS DISTINCT FROM NEW.opponent_rating_deviation",
  ],
  "public.validate_calibrated_bot_action_insert()": [
    "NEW.completed_at < binding_row.bound_at",
    "move.color = binding_row.bot_color",
    "game_row.finish_reason = 'resignation'",
  ],
  "public.guard_bound_game_bot_identity()": [
    "NEW.bot_player_key IS DISTINCT FROM OLD.bot_player_key",
    "NEW.rating_mode IS DISTINCT FROM OLD.rating_mode",
  ],
  "public.validate_calibrated_bot_rating_event_insert()": [
    "binding_row.human_player_key <> NEW.player_key",
    "action.engine_version = binding_row.engine_version",
    "Bot rating evidence must begin at the locked human global state.",
  ],
  "public.validate_calibrated_bot_rating_event_commit()": [
    "event_count <> 1",
    "one complete human state transition",
  ],
  "public.validate_glicko2_state_transition()": [
    "Global rating state changes require matching immutable game evidence.",
  ],
} as const;

async function checkMvp() {
  console.log("GoStone production preflight");

  const missing = requiredVariables.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  if (!getLegalNotice().configured) {
    throw new Error(
      "Legal notice configuration is incomplete for the selected LEGAL_OPERATOR_TYPE.",
    );
  }

  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL!);
  if (appUrl.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use https:// for production.");
  }

  const databaseUrl = process.env.DATABASE_URL!;
  if (isLocalDatabase(databaseUrl)) {
    throw new Error("DATABASE_URL still points to a local database.");
  }

  const database = await query<{
    now: Date;
    ssl: boolean;
    tables: string[];
    game_columns: string[];
    scoring_columns: string[];
    queue_columns: string[];
    japanese_scoring_columns: string[];
    resume_event_columns: string[];
    constraint_signatures: string[];
    rollout_constraint_signatures: string[];
    constraint_definitions: Record<string, string>;
    trigger_signatures: string[];
    trigger_definitions: Record<string, string>;
    rls_tables: string[];
    public_has_table_access: boolean;
    client_roles_have_table_access: boolean;
    public_can_execute_guard_functions: boolean;
    client_roles_can_execute_guard_functions: boolean;
    guard_function_definitions: Record<string, string>;
    index_definitions: Record<string, string>;
    index_states: Record<string, { isReady: boolean; isValid: boolean }>;
    rules_profile_default: string | null;
  }>(
    `SELECT NOW() AS now,
            (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl,
            ARRAY(
              SELECT table_name
                FROM information_schema.tables
               WHERE table_schema = 'public'
                 AND table_name = ANY($1::text[])
               ORDER BY table_name
            ) AS tables,
            ARRAY(
              SELECT column_name
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'games'
                 AND column_name = ANY($2::text[])
               ORDER BY column_name
            ) AS game_columns,
            ARRAY(
              SELECT column_name
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'game_scoring_state'
                 AND column_name = ANY($3::text[])
               ORDER BY column_name
            ) AS scoring_columns,
            ARRAY(
              SELECT column_name
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'matchmaking_queue'
                 AND column_name = ANY($4::text[])
               ORDER BY column_name
            ) AS queue_columns,
            ARRAY(
              SELECT column_name
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'game_japanese_scoring_state'
                 AND column_name = ANY($5::text[])
               ORDER BY column_name
            ) AS japanese_scoring_columns,
            ARRAY(
              SELECT column_name
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'game_scoring_resume_events'
                 AND column_name = ANY($13::text[])
               ORDER BY column_name
            ) AS resume_event_columns,
            ARRAY(
              SELECT constraint_row.conname || ':' || relation.relname || ':'
                     || constraint_row.contype::text
                FROM pg_constraint constraint_row
                JOIN pg_class relation ON relation.oid = constraint_row.conrelid
                JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
               WHERE constraint_row.conname || ':' || relation.relname || ':'
                     || constraint_row.contype::text = ANY($6::text[])
                 AND namespace.nspname = 'public'
                 AND constraint_row.convalidated
               ORDER BY constraint_row.conname
            ) AS constraint_signatures,
            ARRAY(
              SELECT constraint_row.conname || ':' || relation.relname || ':'
                     || constraint_row.contype::text
                FROM pg_constraint constraint_row
                JOIN pg_class relation ON relation.oid = constraint_row.conrelid
                JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
               WHERE constraint_row.conname || ':' || relation.relname || ':'
                     || constraint_row.contype::text = ANY($12::text[])
                 AND namespace.nspname = 'public'
               ORDER BY constraint_row.conname
            ) AS rollout_constraint_signatures,
            (
              SELECT COALESCE(
                JSONB_OBJECT_AGG(
                  constraint_row.conname,
                  pg_get_constraintdef(constraint_row.oid)
                ),
                '{}'::jsonb
              )
                FROM pg_constraint constraint_row
               WHERE constraint_row.conname = ANY($10::text[])
                 AND constraint_row.connamespace = 'public'::regnamespace
                 AND (
                   constraint_row.conname <> 'moves_board_hash_required_check'
                   OR constraint_row.conrelid = 'public.moves'::regclass
                 )
            ) AS constraint_definitions,
            ARRAY(
              SELECT trigger_row.tgname || ':' || relation.relname || ':'
                     || procedure_namespace.nspname || ':' || procedure.proname
                     || ':' || trigger_row.tgtype::text
                FROM pg_trigger trigger_row
                JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
                JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                JOIN pg_proc procedure ON procedure.oid = trigger_row.tgfoid
                JOIN pg_namespace procedure_namespace
                  ON procedure_namespace.oid = procedure.pronamespace
               WHERE trigger_row.tgname || ':' || relation.relname || ':'
                     || procedure_namespace.nspname || ':' || procedure.proname
                     || ':' || trigger_row.tgtype::text = ANY($7::text[])
                 AND namespace.nspname = 'public'
                 AND NOT trigger_row.tgisinternal
                 AND trigger_row.tgenabled IN ('O', 'A')
               ORDER BY trigger_row.tgname
            ) AS trigger_signatures,
            (
              SELECT COALESCE(
                JSONB_OBJECT_AGG(
                  trigger_row.tgname,
                  pg_get_triggerdef(trigger_row.oid)
                ),
                '{}'::jsonb
              )
                FROM pg_trigger trigger_row
               WHERE trigger_row.tgname = ANY($11::text[])
                 AND NOT trigger_row.tgisinternal
            ) AS trigger_definitions,
            ARRAY(
              SELECT relation.relname
                FROM pg_class relation
                JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
               WHERE namespace.nspname = 'public'
                 AND relation.relname = ANY($8::text[])
                 AND relation.relrowsecurity
               ORDER BY relation.relname
            ) AS rls_tables,
            EXISTS (
              SELECT 1
                FROM UNNEST($8::text[]) AS protected_table(table_name)
               WHERE has_table_privilege(
                       'public',
                       FORMAT('public.%I', protected_table.table_name),
                       'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
                     )
                  OR has_any_column_privilege(
                       'public',
                       FORMAT('public.%I', protected_table.table_name),
                       'SELECT, INSERT, UPDATE, REFERENCES'
                     )
            ) AS public_has_table_access,
            EXISTS (
              SELECT 1
                FROM pg_roles role
                CROSS JOIN UNNEST($8::text[]) AS protected_table(table_name)
               WHERE role.rolname IN ('anon', 'authenticated')
                 AND (
                   has_table_privilege(
                     role.oid,
                     FORMAT('public.%I', protected_table.table_name),
                     'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
                   )
                   OR has_any_column_privilege(
                     role.oid,
                     FORMAT('public.%I', protected_table.table_name),
                     'SELECT, INSERT, UPDATE, REFERENCES'
                   )
                 )
            ) AS client_roles_have_table_access,
            EXISTS (
              SELECT 1
                FROM UNNEST($9::text[]) AS guard_function(function_name)
               WHERE has_function_privilege(
                 'public',
                 guard_function.function_name,
                 'EXECUTE'
               )
            ) AS public_can_execute_guard_functions,
            EXISTS (
              SELECT 1
                FROM pg_roles role
                CROSS JOIN UNNEST($9::text[]) AS guard_function(function_name)
               WHERE role.rolname IN ('anon', 'authenticated')
                 AND has_function_privilege(
                   role.oid,
                   guard_function.function_name,
                   'EXECUTE'
                 )
            ) AS client_roles_can_execute_guard_functions,
            (
              SELECT COALESCE(
                JSONB_OBJECT_AGG(
                  guard_function.function_name,
                  pg_get_functiondef(guard_function.function_name::regprocedure)
                ),
                '{}'::jsonb
              )
                FROM UNNEST($14::text[]) AS guard_function(function_name)
            ) AS guard_function_definitions,
            (
              SELECT COALESCE(
                JSONB_OBJECT_AGG(indexname, indexdef),
                '{}'::jsonb
              )
                FROM pg_indexes
               WHERE schemaname = 'public'
                 AND indexname = ANY($15::text[])
            ) AS index_definitions,
            (
              SELECT COALESCE(
                JSONB_OBJECT_AGG(
                  index_relation.relname,
                  JSONB_BUILD_OBJECT(
                    'isReady', index_row.indisready,
                    'isValid', index_row.indisvalid
                  )
                ),
                '{}'::jsonb
              )
                FROM pg_index index_row
                JOIN pg_class index_relation
                  ON index_relation.oid = index_row.indexrelid
                JOIN pg_namespace index_namespace
                  ON index_namespace.oid = index_relation.relnamespace
               WHERE index_namespace.nspname = 'public'
                 AND index_relation.relname = ANY($15::text[])
            ) AS index_states,
            (
              SELECT column_default
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'games'
                 AND column_name = 'rules_profile'
            ) AS rules_profile_default`,
    [
      requiredTables,
      requiredGameColumns,
      requiredScoringColumns,
      requiredQueueColumns,
      requiredJapaneseScoringColumns,
      requiredConstraintSignatures,
      requiredTriggerSignatures,
      requiredProtectedTables,
      requiredGuardFunctions,
      Object.keys(requiredConstraintDefinitions),
      Object.keys(requiredTriggerDefinitions),
      requiredRolloutConstraintSignatures,
      requiredResumeEventColumns,
      Object.keys(requiredGuardFunctionDefinitions),
      Object.keys(requiredIndexDefinitions),
    ],
  );

  const row = database.rows[0];
  for (const [indexName, fragments] of Object.entries(requiredIndexDefinitions)) {
    const definition = row.index_definitions[indexName];
    const state = row.index_states[indexName];
    if (
      !definition
      || fragments.some((fragment) => !definition.includes(fragment))
      || !state?.isReady
      || !state.isValid
    ) {
      throw new Error(`Database index is incomplete: ${indexName}`);
    }
  }
  const absentTables = requiredTables.filter((table) => !row.tables.includes(table));
  if (absentTables.length > 0) {
    throw new Error(
      `Database migrations are incomplete. Missing tables: ${absentTables.join(", ")}`,
    );
  }
  const absentGameColumns = requiredGameColumns.filter(
    (column) => !row.game_columns.includes(column),
  );
  if (absentGameColumns.length > 0) {
    throw new Error(
      `Database scoring migration is incomplete. Missing games columns: ${absentGameColumns.join(", ")}`,
    );
  }
  const absentScoringColumns = requiredScoringColumns.filter(
    (column) => !row.scoring_columns.includes(column),
  );
  if (absentScoringColumns.length > 0) {
    throw new Error(
      `Database scoring migration is incomplete. Missing scoring columns: ${absentScoringColumns.join(", ")}`,
    );
  }
  const absentQueueColumns = requiredQueueColumns.filter(
    (column) => !row.queue_columns.includes(column),
  );
  if (absentQueueColumns.length > 0) {
    throw new Error(
      `Database matchmaking migration is incomplete. Missing queue columns: ${absentQueueColumns.join(", ")}`,
    );
  }
  const absentJapaneseScoringColumns = requiredJapaneseScoringColumns.filter(
    (column) => !row.japanese_scoring_columns.includes(column),
  );
  if (absentJapaneseScoringColumns.length > 0) {
    throw new Error(
      `Database Japanese persistence migration is incomplete. Missing scoring columns: ${absentJapaneseScoringColumns.join(", ")}`,
    );
  }
  const absentResumeEventColumns = requiredResumeEventColumns.filter(
    (column) => !row.resume_event_columns.includes(column),
  );
  if (absentResumeEventColumns.length > 0) {
    throw new Error(
      `Database resume evidence migration is incomplete. Missing columns: ${absentResumeEventColumns.join(", ")}`,
    );
  }
  const absentConstraints = requiredConstraintSignatures.filter(
    (constraint) => !row.constraint_signatures.includes(constraint),
  );
  if (absentConstraints.length > 0) {
    throw new Error(
      `Database persistence invariants are incomplete. Missing constraints: ${absentConstraints.join(", ")}`,
    );
  }
  const absentRolloutConstraints = requiredRolloutConstraintSignatures.filter(
    (constraint) => !row.rollout_constraint_signatures.includes(constraint),
  );
  if (absentRolloutConstraints.length > 0) {
    throw new Error(
      `Database rollout invariants are incomplete. Missing constraints: ${absentRolloutConstraints.join(", ")}`,
    );
  }
  for (const [name, contract] of Object.entries(requiredConstraintDefinitions)) {
    const definition = row.constraint_definitions[name] ?? "";
    const missingFragments = contract.includes.filter(
      (fragment) => !definition.includes(fragment),
    );
    const forbiddenFragments = contract.excludes.filter(
      (fragment) => definition.includes(fragment),
    );
    if (missingFragments.length > 0 || forbiddenFragments.length > 0) {
      throw new Error(`Database constraint definition is unsafe: ${name}`);
    }
  }
  const absentTriggers = requiredTriggerSignatures.filter(
    (trigger) => !row.trigger_signatures.includes(trigger),
  );
  if (absentTriggers.length > 0) {
    throw new Error(
      `Database persistence guards are incomplete. Missing triggers: ${absentTriggers.join(", ")}`,
    );
  }
  for (const [name, fragment] of Object.entries(requiredTriggerDefinitions)) {
    if (!(row.trigger_definitions[name] ?? "").includes(fragment)) {
      throw new Error(`Database trigger definition is unsafe: ${name}`);
    }
  }
  const absentRls = requiredProtectedTables.filter(
    (table) => !row.rls_tables.includes(table),
  );
  if (absentRls.length > 0) {
    throw new Error(
      `Database client isolation is incomplete. RLS is disabled on: ${absentRls.join(", ")}`,
    );
  }
  if (row.public_has_table_access) {
    throw new Error(
      "Database client isolation is incomplete: PUBLIC can access protected server tables.",
    );
  }
  if (row.client_roles_have_table_access) {
    throw new Error(
      "Database client isolation is incomplete: anon/authenticated can access protected server tables.",
    );
  }
  if (row.public_can_execute_guard_functions) {
    throw new Error(
      "Database persistence guards are callable through the PUBLIC pseudo-role.",
    );
  }
  if (row.client_roles_can_execute_guard_functions) {
    throw new Error(
      "Database persistence guards are callable through anon/authenticated roles.",
    );
  }
  for (const [name, fragments] of Object.entries(requiredGuardFunctionDefinitions)) {
    const definition = row.guard_function_definitions[name] ?? "";
    if (fragments.some((fragment) => !definition.includes(fragment))) {
      throw new Error(`Database guard function definition is unsafe: ${name}`);
    }
  }
  if (!row.rules_profile_default?.includes("legacy-immediate-area")) {
    throw new Error(
      "Migration 008 is not rollout-safe: games.rules_profile must keep the legacy default during the expand phase.",
    );
  }
  if (!row.ssl) {
    throw new Error("The production database connection is not using SSL.");
  }

  console.log(`Database connected securely at ${row.now.toISOString()}.`);
  console.log("Required tables and legal configuration are present.");
  console.log("MVP production preflight passed.");
}

checkMvp()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
