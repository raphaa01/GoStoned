import "dotenv/config";
import { closePool, query } from "../lib/db";
import { getDatabaseUrl, isLocalDatabase } from "../lib/env";
import { validateProductionSchemaContract } from "../lib/deployment/productionSchemaContract";

type SchemaRow = {
  game_rules_default: string | null;
  game_rules_profile_default: string | null;
  game_scoring_method_default: string | null;
  game_komi_default: string | null;
  queue_rules_profile_default: string | null;
  queue_profile_constraint: string | null;
  queue_adaptive_constraint: string | null;
  initial_rating_policy_constraint: string | null;
  puzzle_category_constraint: string | null;
  board_placement_data_type: string | null;
  board_placement_default: string | null;
  board_placement_nullable: string | null;
  board_placement_constraint: string | null;
  board_design_data_type: string | null;
  board_design_default: string | null;
  board_design_nullable: string | null;
  board_design_constraint: string | null;
  analysis_progress_data_type: string | null;
  analysis_progress_constraint: string | null;
  takeback_rls: boolean;
  learn_progress_rls: boolean;
  learn_progress_writable: boolean;
};

async function checkProductionSchema(): Promise<void> {
  console.log("Checking production schema requirements.");

  const databaseUrl = getDatabaseUrl();
  if (isLocalDatabase(databaseUrl)) {
    throw new Error("Production schema check refuses a local DATABASE_URL.");
  }

  const result = await query<SchemaRow>(
    `SELECT
       (SELECT column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'rules')
         AS game_rules_default,
       (SELECT column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'rules_profile')
         AS game_rules_profile_default,
       (SELECT column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'scoring_method')
         AS game_scoring_method_default,
       (SELECT column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'komi')
         AS game_komi_default,
       (SELECT column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'matchmaking_queue' AND column_name = 'rules_profile')
         AS queue_rules_profile_default,
       (SELECT pg_get_constraintdef(oid)
          FROM pg_constraint
         WHERE conname = 'matchmaking_queue_rules_profile_compatibility_check'
           AND conrelid = 'public.matchmaking_queue'::regclass)
         AS queue_profile_constraint,
       (SELECT pg_get_constraintdef(oid)
          FROM pg_constraint
         WHERE conname = 'matchmaking_queue_adaptive_state_check'
           AND conrelid = 'public.matchmaking_queue'::regclass)
         AS queue_adaptive_constraint,
       (SELECT pg_get_constraintdef(oid)
          FROM pg_constraint
         WHERE conname = 'player_initial_rating_claims_policy_version_check'
           AND conrelid = 'public.player_initial_rating_claims'::regclass)
         AS initial_rating_policy_constraint,
       (SELECT pg_get_constraintdef(oid)
          FROM pg_constraint
         WHERE conname = 'puzzles_category_shape_check'
           AND conrelid = 'public.puzzles'::regclass)
         AS puzzle_category_constraint,
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'board_design') AS board_design_data_type,
       (SELECT column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'board_design') AS board_design_default,
       (SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'board_design') AS board_design_nullable,
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conname = 'users_board_design_check' AND conrelid = 'public.users'::regclass) AS board_design_constraint,
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'player_rating_preferences'
           AND column_name = 'board_placement')
         AS board_placement_data_type,
       (SELECT column_default FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'player_rating_preferences'
           AND column_name = 'board_placement')
         AS board_placement_default,
       (SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'player_rating_preferences'
           AND column_name = 'board_placement')
         AS board_placement_nullable,
       (SELECT pg_get_constraintdef(oid)
          FROM pg_constraint
         WHERE conname = 'player_rating_preferences_board_placement_check'
           AND conrelid = 'public.player_rating_preferences'::regclass)
         AS board_placement_constraint,
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'game_analysis_jobs'
           AND column_name = 'progress')
         AS analysis_progress_data_type,
       (SELECT pg_get_constraintdef(oid)
          FROM pg_constraint
         WHERE conname = 'game_analysis_jobs_result_shape_check'
           AND conrelid = 'public.game_analysis_jobs'::regclass)
         AS analysis_progress_constraint,
       EXISTS (
         SELECT 1
           FROM pg_class relation
           JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public'
            AND relation.relname = 'game_takeback_requests'
            AND relation.relrowsecurity
       ) AS takeback_rls,
       EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.learn_progress') AND relrowsecurity) AS learn_progress_rls,
       COALESCE(
         has_table_privilege(current_user, to_regclass('public.learn_progress'), 'SELECT')
         AND has_table_privilege(current_user, to_regclass('public.learn_progress'), 'INSERT')
         AND has_table_privilege(current_user, to_regclass('public.learn_progress'), 'UPDATE'),
         false
       ) AS learn_progress_writable`,
  );

  const row = result.rows[0];
  if (!row) throw new Error("Production schema check returned no result.");

  validateProductionSchemaContract({
    gameRulesDefault: row.game_rules_default,
    gameRulesProfileDefault: row.game_rules_profile_default,
    gameScoringMethodDefault: row.game_scoring_method_default,
    gameKomiDefault: row.game_komi_default,
    queueRulesProfileDefault: row.queue_rules_profile_default,
    queueProfileConstraint: row.queue_profile_constraint,
    queueAdaptiveConstraint: row.queue_adaptive_constraint,
    initialRatingPolicyConstraint: row.initial_rating_policy_constraint,
    puzzleCategoryConstraint: row.puzzle_category_constraint,
    boardPlacementDataType: row.board_placement_data_type,
    boardPlacementDefault: row.board_placement_default,
    boardPlacementNullable: row.board_placement_nullable,
    boardPlacementConstraint: row.board_placement_constraint,
    boardDesignDataType: row.board_design_data_type,
    boardDesignDefault: row.board_design_default,
    boardDesignNullable: row.board_design_nullable,
    boardDesignConstraint: row.board_design_constraint,
    analysisProgressDataType: row.analysis_progress_data_type,
    analysisProgressConstraint: row.analysis_progress_constraint,
    takebackRls: row.takeback_rls,
    learnProgressRls: row.learn_progress_rls,
    learnProgressWritable: row.learn_progress_writable,
  });

  // The migration ledger is intentionally hidden by RLS from the runtime role.
  // CI executes the complete migration chain; production verifies its effective
  // schema contract above without weakening that privacy boundary.
  console.log("Production schema requirements are current.");
}

checkProductionSchema()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
