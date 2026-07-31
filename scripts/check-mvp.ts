import "dotenv/config";
import { closePool, query } from "../lib/db";
import { isLocalDatabase } from "../lib/env";
import { getLegalNotice } from "../lib/legal";

const requiredVariables = [
  "DATABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "LEGAL_OPERATOR_TYPE",
  "LEGAL_NAME",
  "LEGAL_STREET",
  "LEGAL_CITY",
  "LEGAL_EMAIL",
] as const;

const requiredTables = [
  "schema_migrations",
  "users",
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
  "game_scoring_state",
  "game_dead_stones",
  "game_scoring_resume_events",
  "game_japanese_resume_authorizations",
  "game_japanese_scoring_state",
  "game_japanese_scoring_proposals",
  "game_japanese_scoring_terminal_events",
  "game_japanese_repetition_claims",
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

const requiredQueueColumns = ["rules_profile"] as const;

const requiredJapaneseScoringColumns = [
  "proposal_hash",
  "black_confirmed_proposal_hash",
  "white_confirmed_proposal_hash",
  "scored_proposal_hash",
  "expires_at",
  "black_participated_at",
  "white_participated_at",
  "suggestion_status",
  "suggestion_request_identity",
  "suggestion_provider_kind",
  "suggestion_engine_version",
  "suggestion_model_version",
  "suggestion_config_version",
  "suggestion_confidence_policy_version",
  "suggestion_latency_ms",
  "suggestion_error_class",
] as const;

const requiredJapaneseProposalColumns = [
  "game_id", "scoring_revision", "proposal_hash", "source", "actor_color",
  "parent_scoring_revision", "dead_stones", "neutral_region_seeds",
  "stopped_move_number", "stopped_board_hash", "rules", "rules_profile",
  "scoring_method", "komi", "handicap", "suggestion_request_identity",
  "suggestion_provider_kind", "suggestion_engine_version", "suggestion_model_version",
  "suggestion_config_version", "suggestion_confidence_policy_version",
  "suggestion_latency_ms", "created_at",
] as const;

const requiredJapaneseTerminalColumns = [
  "game_id", "scoring_revision", "proposal_hash", "stopped_move_number",
  "stopped_board_hash", "rules", "rules_profile", "scoring_method", "komi",
  "handicap", "outcome_kind", "winner_color", "abandoned_by_color",
  "suggestion_request_identity", "suggestion_status", "suggestion_provider_kind",
  "suggestion_engine_version", "suggestion_model_version", "suggestion_config_version",
  "suggestion_confidence_policy_version", "suggestion_latency_ms",
  "suggestion_error_class", "adjudication_proposal_hash",
  "adjudication_dead_stones", "adjudication_neutral_region_seeds",
  "adjudication_request_identity", "adjudication_provider_kind",
  "adjudication_engine_version", "adjudication_model_version",
  "adjudication_config_version", "adjudication_confidence_policy_version",
  "adjudication_latency_ms", "adjudication_error_class",
  "captured_white_by_black_at_stop",
  "captured_black_by_white_at_stop", "living_black_stones", "living_white_stones",
  "black_territory", "white_territory", "dame_points",
  "territory_excluded_by_agreement", "dead_black_stones", "dead_white_stones",
  "black_prisoners_final", "white_prisoners_final", "black_total", "white_total",
  "margin", "created_at",
] as const;

const requiredGlobalRatingColumns = [
  "player_key", "user_id", "rating", "rating_deviation", "volatility",
  "rated_game_count", "is_provisional", "algorithm_version",
  "last_rating_period_at", "created_at", "updated_at",
] as const;

const requiredGameRatingEventColumns = [
  "game_id", "player_key", "opponent_key", "opponent_kind",
  "opponent_profile_version", "player_color", "outcome_kind", "score",
  "finish_reason", "game_result", "game_finished_at", "opponent_rating",
  "opponent_rating_deviation", "rating_before", "rating_after",
  "rating_deviation_before", "rating_deviation_after", "volatility_before",
  "volatility_after", "rated_game_count_before", "rated_game_count_after",
  "last_rating_period_at_before", "last_rating_period_at_after",
  "algorithm_version", "rating_period_at", "processed_at",
] as const;

const requiredLegacyRatingColumns = ["rating_algorithm_version"] as const;

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

const requiredJapaneseResumeAuthorizationColumns = [
  "game_id",
  "resumption_number",
  "scoring_revision",
  "stopped_move_number",
  "stopped_board_hash",
  "requested_by_color",
  "rules",
  "rules_profile",
  "scoring_method",
  "komi",
  "handicap",
  "authorized_at",
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
  "games_rules_profile_check:games:c",
  "games_scoring_method_check:games:c",
  "games_rules_check:games:c",
  "games_finish_reason_check:games:c",
  "game_japanese_repetition_claims_pkey:game_japanese_repetition_claims:p",
  "game_japanese_repetition_claims_game_fk:game_japanese_repetition_claims:f",
  "game_japanese_repetition_claims_move_fk:game_japanese_repetition_claims:f",
  "game_japanese_repetition_claims_prior_move_fk:game_japanese_repetition_claims:f",
  "game_japanese_repetition_claims_game_rules_fk:game_japanese_repetition_claims:f",
  "game_scoring_state_game_rules_fk:game_scoring_state:f",
  "game_japanese_scoring_game_rules_fk:game_japanese_scoring_state:f",
  "game_japanese_resume_authorizations_pkey:game_japanese_resume_authorizations:p",
  "game_japanese_resume_authorizations_stopped_move_key:game_japanese_resume_authorizations:u",
  "game_japanese_resume_authorizations_game_fk:game_japanese_resume_authorizations:f",
  "game_japanese_resume_authorizations_number_check:game_japanese_resume_authorizations:c",
  "game_japanese_resume_authorizations_revision_check:game_japanese_resume_authorizations:c",
  "game_japanese_resume_authorizations_stopped_move_check:game_japanese_resume_authorizations:c",
  "game_japanese_resume_authorizations_board_hash_check:game_japanese_resume_authorizations:c",
  "game_japanese_resume_authorizations_requested_by_check:game_japanese_resume_authorizations:c",
  "game_japanese_resume_authorizations_rules_check:game_japanese_resume_authorizations:c",
  "game_japanese_resume_authorizations_rules_profile_check:game_japanese_resume_authorizations:c",
  "game_japanese_resume_authorizations_scoring_method_check:game_japanese_resume_authorizations:c",
  "game_japanese_resume_authorizations_komi_check:game_japanese_resume_authorizations:c",
  "game_japanese_resume_authorizations_handicap_check:game_japanese_resume_authorizations:c",
  "game_japanese_resume_authorizations_game_rules_fk:game_japanese_resume_authorizations:f",
  "game_japanese_scoring_deadline_check:game_japanese_scoring_state:c",
  "game_japanese_scoring_participation_check:game_japanese_scoring_state:c",
  "game_japanese_scoring_suggestion_check:game_japanese_scoring_state:c",
  "game_japanese_scoring_proposals_pkey:game_japanese_scoring_proposals:p",
  "game_japanese_scoring_proposals_game_fk:game_japanese_scoring_proposals:f",
  "game_japanese_scoring_proposals_parent_fk:game_japanese_scoring_proposals:f",
  "game_japanese_scoring_proposals_game_rules_fk:game_japanese_scoring_proposals:f",
  "game_japanese_scoring_terminal_events_pkey:game_japanese_scoring_terminal_events:p",
  "game_japanese_scoring_terminal_events_game_fk:game_japanese_scoring_terminal_events:f",
  "game_japanese_scoring_terminal_events_game_rules_fk:game_japanese_scoring_terminal_events:f",
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
  games_rules_profile_check: {
    includes: ["legacy-immediate-area", "chinese-2002-gostone-v1", "japanese-1989-gostone-v1"],
    excludes: [],
  },
  games_scoring_method_check: {
    includes: ["area", "territory"],
    excludes: [],
  },
  games_rules_check: {
    includes: ["chinese", "japanese"],
    excludes: [],
  },
  games_finish_reason_check: {
    includes: ["score", "resignation", "timeout", "japanese_adjudication", "japanese_no_result", "japanese_abandonment", "japanese_repetition"],
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
  game_japanese_repetition_claims_pkey: {
    includes: ["PRIMARY KEY (game_id, move_number, claimant_color)"],
    excludes: [],
  },
  game_japanese_repetition_claims_game_fk: {
    includes: ["FOREIGN KEY (game_id)", "REFERENCES games(id)", "ON DELETE RESTRICT"],
    excludes: [],
  },
  game_japanese_repetition_claims_move_fk: {
    includes: ["FOREIGN KEY (game_id, move_number)", "REFERENCES moves(game_id, move_number)", "ON DELETE RESTRICT"],
    excludes: [],
  },
  game_japanese_repetition_claims_prior_move_fk: {
    includes: ["FOREIGN KEY (game_id, repeated_from_move_number)", "REFERENCES moves(game_id, move_number)", "ON DELETE RESTRICT"],
    excludes: [],
  },
  game_japanese_repetition_claims_game_rules_fk: {
    includes: ["FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)", "REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)", "ON DELETE RESTRICT"],
    excludes: [],
  },
  game_japanese_resume_authorizations_pkey: {
    includes: ["PRIMARY KEY (game_id, resumption_number)"],
    excludes: [],
  },
  game_japanese_resume_authorizations_stopped_move_key: {
    includes: ["UNIQUE (game_id, stopped_move_number)"],
    excludes: [],
  },
  game_japanese_resume_authorizations_game_fk: {
    includes: ["FOREIGN KEY (game_id)", "REFERENCES games(id)", "ON DELETE CASCADE"],
    excludes: [],
  },
  game_japanese_resume_authorizations_number_check: {
    includes: ["resumption_number >= 1", "resumption_number <= 3"],
    excludes: [],
  },
  game_japanese_resume_authorizations_revision_check: {
    includes: ["scoring_revision > 0"],
    excludes: [],
  },
  game_japanese_resume_authorizations_stopped_move_check: {
    includes: ["stopped_move_number >= 2"],
    excludes: [],
  },
  game_japanese_resume_authorizations_board_hash_check: {
    includes: ["length(stopped_board_hash) > 0"],
    excludes: [],
  },
  game_japanese_resume_authorizations_requested_by_check: {
    includes: ["requested_by_color", "black", "white"],
    excludes: [],
  },
  game_japanese_resume_authorizations_rules_check: {
    includes: ["rules = 'japanese'::text"],
    excludes: [],
  },
  game_japanese_resume_authorizations_rules_profile_check: {
    includes: ["rules_profile = 'japanese-1989-gostone-v1'::text"],
    excludes: [],
  },
  game_japanese_resume_authorizations_scoring_method_check: {
    includes: ["scoring_method = 'territory'::text"],
    excludes: [],
  },
  game_japanese_resume_authorizations_komi_check: {
    includes: ["komi = 6.5"],
    excludes: [],
  },
  game_japanese_resume_authorizations_handicap_check: {
    includes: ["handicap = 0"],
    excludes: [],
  },
  game_japanese_resume_authorizations_game_rules_fk: {
    includes: [
      "FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)",
      "REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)",
      "ON DELETE CASCADE",
    ],
    excludes: [],
  },
  game_japanese_scoring_deadline_check: {
    includes: ["expires_at", "00:00:30", "01:00:00"],
    excludes: [],
  },
  game_japanese_scoring_participation_check: {
    includes: ["black_participated_at", "white_participated_at", "expires_at"],
    excludes: [],
  },
  game_japanese_scoring_suggestion_check: {
    includes: ["pending", "ready", "unavailable", "invalid", "low_confidence"],
    excludes: [],
  },
  game_japanese_scoring_proposals_pkey: {
    includes: ["PRIMARY KEY (game_id, scoring_revision)"],
    excludes: [],
  },
  game_japanese_scoring_proposals_game_fk: {
    includes: ["FOREIGN KEY (game_id)", "REFERENCES games(id)", "ON DELETE CASCADE"],
    excludes: [],
  },
  game_japanese_scoring_proposals_parent_fk: {
    includes: ["FOREIGN KEY (game_id, parent_scoring_revision)", "REFERENCES game_japanese_scoring_proposals(game_id, scoring_revision)"],
    excludes: [],
  },
  game_japanese_scoring_proposals_game_rules_fk: {
    includes: ["FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)", "REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)", "ON DELETE CASCADE"],
    excludes: [],
  },
  game_japanese_scoring_terminal_events_pkey: {
    includes: ["PRIMARY KEY (game_id)"],
    excludes: [],
  },
  game_japanese_scoring_terminal_events_game_fk: {
    includes: ["FOREIGN KEY (game_id)", "REFERENCES games(id)", "ON DELETE CASCADE"],
    excludes: [],
  },
  game_japanese_scoring_terminal_events_game_rules_fk: {
    includes: ["FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)", "REFERENCES games(id, rules, rules_profile, scoring_method, komi, handicap)", "ON DELETE CASCADE"],
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
    includes: ["legacy-immediate-area", "chinese-2002-gostone-v1", "japanese-1989-gostone-v1"],
    excludes: [],
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
} as const;

const requiredTriggerSignatures = [
  "matchmaking_rules_profile_guard:matchmaking_queue:public:enforce_matchmaking_rules_profile:23",
  "game_rules_identity_mutation_guard:games:public:guard_game_rules_identity_mutation:19",
  "game_scoring_resume_events_insert_guard:game_scoring_resume_events:public:validate_game_scoring_resume_event_insert:7",
  "game_scoring_resume_events_commit_guard:game_scoring_resume_events:public:validate_game_scoring_resume_event_commit:5",
  "game_scoring_resume_events_immutable_guard:game_scoring_resume_events:public:guard_game_scoring_resume_event_mutation:27",
  "game_scoring_resume_events_truncate_guard:game_scoring_resume_events:public:guard_game_scoring_resume_event_mutation:34",
  "game_japanese_scoring_state_mutation_guard:game_japanese_scoring_state:public:guard_japanese_scoring_state_mutation:27",
  "game_japanese_resume_authorizations_insert_guard:game_japanese_resume_authorizations:public:validate_game_japanese_resume_authorization_insert:7",
  "game_japanese_resume_authorization_window_guard:game_japanese_resume_authorizations:public:guard_japanese_resume_authorization_window:7",
  "game_japanese_resume_authorizations_commit_guard:game_japanese_resume_authorizations:public:validate_game_japanese_resume_authorization_commit:5",
  "game_japanese_resume_authorizations_immutable_guard:game_japanese_resume_authorizations:public:guard_game_japanese_resume_authorization_mutation:27",
  "game_japanese_resume_authorizations_truncate_guard:game_japanese_resume_authorizations:public:guard_game_japanese_resume_authorization_mutation:34",
  "game_japanese_resume_transition_guard:games:public:guard_game_japanese_resume_transition:19",
  "game_japanese_scoring_state_proposal_commit_guard:game_japanese_scoring_state:public:validate_japanese_scoring_state_proposal_commit:21",
  "game_japanese_scoring_proposals_insert_guard:game_japanese_scoring_proposals:public:validate_japanese_scoring_proposal_insert:7",
  "game_japanese_scoring_proposals_immutable_guard:game_japanese_scoring_proposals:public:guard_japanese_append_only_evidence:27",
  "game_japanese_scoring_proposals_truncate_guard:game_japanese_scoring_proposals:public:guard_japanese_append_only_evidence:34",
  "game_japanese_scoring_terminal_insert_guard:game_japanese_scoring_terminal_events:public:validate_japanese_scoring_terminal_insert:7",
  "game_japanese_scoring_terminal_commit_guard:game_japanese_scoring_terminal_events:public:validate_japanese_scoring_terminal_commit:5",
  "game_japanese_scoring_terminal_immutable_guard:game_japanese_scoring_terminal_events:public:guard_japanese_append_only_evidence:27",
  "game_japanese_scoring_terminal_truncate_guard:game_japanese_scoring_terminal_events:public:guard_japanese_append_only_evidence:34",
  "game_japanese_dead_stones_mutation_guard:game_japanese_dead_stones:public:guard_japanese_scoring_evidence_mutation:31",
  "game_japanese_neutral_seeds_mutation_guard:game_japanese_neutral_region_seeds:public:guard_japanese_scoring_evidence_mutation:31",
  "game_japanese_repetition_claim_insert_guard:game_japanese_repetition_claims:public:validate_japanese_repetition_claim_insert:7",
  "game_japanese_repetition_claim_commit_guard:game_japanese_repetition_claims:public:validate_japanese_repetition_claim_commit:5",
  "game_japanese_repetition_claim_immutable_guard:game_japanese_repetition_claims:public:guard_japanese_repetition_claim_mutation:27",
  "game_japanese_repetition_claim_truncate_guard:game_japanese_repetition_claims:public:guard_japanese_repetition_claim_mutation:34",
  "game_japanese_repetition_finish_guard:games:public:guard_japanese_repetition_finish:19",
  "game_glicko2_rating_events_insert_guard:game_glicko2_rating_events:public:validate_glicko2_rating_event_insert:7",
  "game_glicko2_rating_events_commit_guard:game_glicko2_rating_events:public:validate_glicko2_rating_event_commit:5",
  "game_glicko2_rating_events_immutable_guard:game_glicko2_rating_events:public:guard_glicko2_rating_event_mutation:27",
  "game_glicko2_rating_events_truncate_guard:game_glicko2_rating_events:public:guard_glicko2_rating_event_mutation:34",
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
  game_japanese_resume_authorizations_insert_guard:
    "BEFORE INSERT ON public.game_japanese_resume_authorizations",
  game_japanese_resume_authorization_window_guard:
    "BEFORE INSERT ON public.game_japanese_resume_authorizations",
  game_japanese_resume_authorizations_commit_guard:
    "AFTER INSERT ON public.game_japanese_resume_authorizations DEFERRABLE INITIALLY DEFERRED",
  game_japanese_resume_authorizations_immutable_guard:
    "BEFORE DELETE OR UPDATE ON public.game_japanese_resume_authorizations",
  game_japanese_resume_authorizations_truncate_guard:
    "BEFORE TRUNCATE ON public.game_japanese_resume_authorizations",
  game_japanese_resume_transition_guard:
    "UPDATE OF status, phase, to_move, consecutive_passes, scoring_revision",
  game_japanese_scoring_state_proposal_commit_guard:
    "AFTER INSERT OR UPDATE ON public.game_japanese_scoring_state DEFERRABLE INITIALLY DEFERRED",
  game_japanese_scoring_proposals_insert_guard:
    "BEFORE INSERT ON public.game_japanese_scoring_proposals",
  game_japanese_scoring_terminal_insert_guard:
    "BEFORE INSERT ON public.game_japanese_scoring_terminal_events",
  game_japanese_scoring_terminal_commit_guard:
    "AFTER INSERT ON public.game_japanese_scoring_terminal_events DEFERRABLE INITIALLY DEFERRED",
  game_japanese_repetition_claim_insert_guard:
    "BEFORE INSERT ON public.game_japanese_repetition_claims",
  game_japanese_repetition_claim_commit_guard:
    "AFTER INSERT ON public.game_japanese_repetition_claims DEFERRABLE INITIALLY DEFERRED",
  game_japanese_repetition_claim_immutable_guard:
    "BEFORE DELETE OR UPDATE ON public.game_japanese_repetition_claims",
  game_japanese_repetition_claim_truncate_guard:
    "BEFORE TRUNCATE ON public.game_japanese_repetition_claims",
  game_japanese_repetition_finish_guard:
    "UPDATE OF status, phase, to_move, finish_reason, result, winner_key",
  game_glicko2_rating_events_insert_guard:
    "BEFORE INSERT ON public.game_glicko2_rating_events",
  game_glicko2_rating_events_commit_guard:
    "AFTER INSERT ON public.game_glicko2_rating_events DEFERRABLE INITIALLY DEFERRED",
  game_glicko2_rating_events_immutable_guard:
    "BEFORE DELETE OR UPDATE ON public.game_glicko2_rating_events",
  game_glicko2_rating_events_truncate_guard:
    "BEFORE TRUNCATE ON public.game_glicko2_rating_events",
} as const;

const requiredProtectedTables = [
  "users",
  "user_sessions",
  "player_blocks",
  "player_reports",
  "game_scoring_resume_events",
  "game_japanese_resume_authorizations",
  "game_japanese_scoring_proposals",
  "game_japanese_scoring_terminal_events",
  "game_japanese_scoring_state",
  "game_japanese_dead_stones",
  "game_japanese_neutral_region_seeds",
  "game_analysis_jobs",
  "katago_workers",
  "game_bots",
  "puzzles",
  "puzzle_generation_jobs",
  "puzzle_attempts",
  "game_japanese_repetition_claims",
  "player_glicko2_ratings",
  "game_glicko2_rating_events",
] as const;

const requiredGuardFunctions = [
  "public.enforce_matchmaking_rules_profile()",
  "public.guard_game_rules_identity_mutation()",
  "public.validate_game_scoring_resume_event_insert()",
  "public.validate_game_scoring_resume_event_commit()",
  "public.guard_game_scoring_resume_event_mutation()",
  "public.guard_game_japanese_resume_authorization_mutation()",
  "public.validate_game_japanese_resume_authorization_insert()",
  "public.validate_game_japanese_resume_authorization_commit()",
  "public.guard_japanese_resume_authorization_window()",
  "public.guard_game_japanese_resume_transition()",
  "public.guard_japanese_append_only_evidence()",
  "public.validate_japanese_scoring_proposal_insert()",
  "public.validate_japanese_scoring_terminal_insert()",
  "public.validate_japanese_scoring_terminal_commit()",
  "public.validate_japanese_scoring_state_proposal_commit()",
  "public.guard_japanese_scoring_state_mutation()",
  "public.guard_japanese_scoring_evidence_mutation()",
  "public.validate_japanese_repetition_claim_insert()",
  "public.validate_japanese_repetition_claim_commit()",
  "public.guard_japanese_repetition_finish()",
  "public.guard_japanese_repetition_claim_mutation()",
  "public.guard_glicko2_rating_event_mutation()",
  "public.validate_glicko2_rating_event_insert()",
  "public.validate_glicko2_rating_event_commit()",
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
  "public.guard_game_japanese_resume_authorization_mutation()": [
    "TG_OP = 'TRUNCATE'",
    "PERFORM 1 FROM public.games WHERE id = OLD.game_id",
    "Japanese resume authorizations are append-only.",
  ],
  "public.validate_game_japanese_resume_authorization_insert()": [
    "FROM public.games AS game",
    "FOR UPDATE",
    "MAX(resumption_number)",
    "expected_resumption_number > 3",
    "FROM public.game_japanese_scoring_state AS scoring",
    "scoring_snapshot.black_confirmed_revision IS NOT NULL",
    "AND scoring_snapshot.white_confirmed_revision IS NOT NULL",
    "NEW.authorized_at := statement_timestamp()",
  ],
  "public.validate_game_japanese_resume_authorization_commit()": [
    "lifecycle.scoring_revision IS DISTINCT FROM NEW.scoring_revision + 1",
    "CASE NEW.requested_by_color WHEN 'black' THEN 'white' ELSE 'black' END",
    "lifecycle.has_japanese_scoring_state",
  ],
  "public.guard_japanese_resume_authorization_window()": [
    "FROM public.games WHERE id = NEW.game_id FOR UPDATE",
    "statement_timestamp() >= scoring_row.expires_at",
    "scoring_row.suggestion_status = 'pending'",
  ],
  "public.guard_game_japanese_resume_transition()": [
    "JOIN public.game_japanese_resume_authorizations AS resume_authorization",
    "resume_snapshot.black_confirmed_revision IS NOT NULL",
    "AND resume_snapshot.white_confirmed_revision IS NOT NULL",
    "NEW.scoring_revision IS DISTINCT FROM OLD.scoring_revision + 1",
  ],
  "public.guard_japanese_scoring_state_mutation()": [
    "JOIN public.game_japanese_resume_authorizations AS resume_authorization",
    "game.phase = 'play'",
    "game.scoring_revision = resume_authorization.scoring_revision + 1",
    "Confirmed Japanese scoring state is immutable.",
    "game.finish_reason IN ('resignation', 'timeout')",
    "game_japanese_scoring_terminal_events",
    "Expired Japanese scoring state may be closed only by deadline resolution.",
    "Pending Japanese scoring does not accept player mutation.",
  ],
  "public.guard_japanese_append_only_evidence()": [
    "Japanese scoring history is append-only.",
    "PERFORM 1 FROM public.games WHERE id = OLD.game_id",
  ],
  "public.validate_japanese_scoring_proposal_insert()": [
    "FROM public.games WHERE id = NEW.game_id FOR UPDATE",
    "FROM public.game_japanese_scoring_state",
    "Initial proposal must preserve validated suggestion diagnostics.",
    "Proposal edits require earlier same-phase provenance.",
  ],
  "public.validate_japanese_scoring_terminal_insert()": [
    "FROM public.games WHERE id = NEW.game_id FOR UPDATE",
    "statement_timestamp() < scoring_row.expires_at",
    "Terminal outcome contradicts participation or suggestion evidence.",
    "NEW.suggestion_status := scoring_row.suggestion_status",
    "Validated score counts must match deadline adjudication evidence.",
  ],
  "public.validate_japanese_scoring_terminal_commit()": [
    "game_row.status <> 'finished'",
    "japanese_adjudication",
    "japanese_no_result",
    "japanese_abandonment",
  ],
  "public.validate_japanese_scoring_state_proposal_commit()": [
    "game_japanese_scoring_proposals",
    "Current Japanese proposal requires append-only history.",
  ],
  "public.validate_japanese_repetition_claim_insert()": [
    "FROM public.games WHERE id = NEW.game_id FOR UPDATE",
    "ORDER BY move.move_number DESC LIMIT 1",
    "prior.board_hash = NEW.board_hash",
  ],
  "public.validate_japanese_repetition_claim_commit()": [
    "COUNT(*)::INT",
    "game_row.finish_reason <> 'japanese_repetition'",
    "matching_claims <> 2",
  ],
  "public.guard_japanese_repetition_finish()": [
    "NEW.finish_reason IS DISTINCT FROM 'japanese_repetition'",
    "matching_claims <> 2",
  ],
  "public.guard_japanese_repetition_claim_mutation()": [
    "Japanese repetition claims are append-only.",
  "public.guard_glicko2_rating_event_mutation()": [
    "Glicko-2 game rating evidence is append-only.",
    "TG_OP = 'DELETE'",
  ],
  "public.validate_glicko2_rating_event_insert()": [
    "FROM public.games WHERE id = NEW.game_id FOR UPDATE",
    "registered-human terminal game",
    "Japanese rating evidence requires exact terminal scoring evidence.",
    "game_japanese_repetition_claims",
    "COUNT(DISTINCT claim.claimant_color) = 2",
    "locked global states",
  ],
  "public.validate_glicko2_rating_event_commit()": [
    "event_count <> 2",
    "complete paired state transition",
    "player_state.rating IS DISTINCT FROM NEW.rating_after",
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
    japanese_resume_authorization_columns: string[];
    japanese_proposal_columns: string[];
    japanese_terminal_columns: string[];
    global_rating_columns: string[];
    game_rating_event_columns: string[];
    legacy_rating_columns: string[];
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
              SELECT column_name
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'game_japanese_resume_authorizations'
                 AND column_name = ANY($16::text[])
               ORDER BY column_name
            ) AS japanese_resume_authorization_columns,
            ARRAY(
              SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'game_japanese_scoring_proposals'
                 AND column_name = ANY($17::text[])
               ORDER BY column_name
            ) AS japanese_proposal_columns,
            ARRAY(
              SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'game_japanese_scoring_terminal_events'
                 AND column_name = ANY($18::text[])
               ORDER BY column_name
            ) AS japanese_terminal_columns,
            ARRAY(
              SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'player_glicko2_ratings'
                 AND column_name = ANY($19::text[])
               ORDER BY column_name
            ) AS global_rating_columns,
            ARRAY(
              SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'game_glicko2_rating_events'
                 AND column_name = ANY($20::text[])
               ORDER BY column_name
            ) AS game_rating_event_columns,
            ARRAY(
              SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'player_rating_history'
                 AND column_name = ANY($21::text[])
               ORDER BY column_name
            ) AS legacy_rating_columns,
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
      requiredJapaneseResumeAuthorizationColumns,
      requiredJapaneseProposalColumns,
      requiredJapaneseTerminalColumns,
      requiredGlobalRatingColumns,
      requiredGameRatingEventColumns,
      requiredLegacyRatingColumns,
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
  const absentJapaneseResumeAuthorizationColumns =
    requiredJapaneseResumeAuthorizationColumns.filter(
      (column) => !row.japanese_resume_authorization_columns.includes(column),
    );
  if (absentJapaneseResumeAuthorizationColumns.length > 0) {
    throw new Error(
      `Database Japanese resume authorization migration is incomplete. Missing columns: ${absentJapaneseResumeAuthorizationColumns.join(", ")}`,
    );
  }
  const absentJapaneseProposalColumns = requiredJapaneseProposalColumns.filter(
    (column) => !row.japanese_proposal_columns.includes(column),
  );
  if (absentJapaneseProposalColumns.length > 0) {
    throw new Error(
      `Database Japanese proposal history is incomplete. Missing columns: ${absentJapaneseProposalColumns.join(", ")}`,
    );
  }
  const absentJapaneseTerminalColumns = requiredJapaneseTerminalColumns.filter(
    (column) => !row.japanese_terminal_columns.includes(column),
  );
  if (absentJapaneseTerminalColumns.length > 0) {
    throw new Error(
      `Database Japanese terminal evidence is incomplete. Missing columns: ${absentJapaneseTerminalColumns.join(", ")}`,
    );
  }
  const absentGlobalRatingColumns = requiredGlobalRatingColumns.filter(
    (column) => !row.global_rating_columns.includes(column),
  );
  if (absentGlobalRatingColumns.length > 0) {
    throw new Error(
      `Database global rating migration is incomplete. Missing columns: ${absentGlobalRatingColumns.join(", ")}`,
    );
  }
  const absentGameRatingEventColumns = requiredGameRatingEventColumns.filter(
    (column) => !row.game_rating_event_columns.includes(column),
  );
  if (absentGameRatingEventColumns.length > 0) {
    throw new Error(
      `Database game rating evidence migration is incomplete. Missing columns: ${absentGameRatingEventColumns.join(", ")}`,
    );
  }
  const absentLegacyRatingColumns = requiredLegacyRatingColumns.filter(
    (column) => !row.legacy_rating_columns.includes(column),
  );
  if (absentLegacyRatingColumns.length > 0) {
    throw new Error(
      `Database legacy rating label migration is incomplete. Missing columns: ${absentLegacyRatingColumns.join(", ")}`,
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
