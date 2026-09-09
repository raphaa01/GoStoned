import "dotenv/config";
import { closePool, query } from "../lib/db";
import { getDatabaseUrl, isLocalDatabase } from "../lib/env";
import {
  JAPANESE_RULES_MIGRATION,
  validateProductionSchemaContract,
} from "../lib/deployment/productionSchemaContract";

type SchemaRow = {
  migration_applied: boolean;
  game_rules_default: string | null;
  game_rules_profile_default: string | null;
  game_scoring_method_default: string | null;
  game_komi_default: string | null;
  queue_rules_profile_default: string | null;
  queue_profile_constraint: string | null;
  queue_adaptive_constraint: string | null;
  takeback_rls: boolean;
};

async function checkProductionSchema(): Promise<void> {
  console.log("Checking production matchmaking and Japanese scoring schema.");

  const databaseUrl = getDatabaseUrl();
  if (isLocalDatabase(databaseUrl)) {
    throw new Error("Production schema check refuses a local DATABASE_URL.");
  }

  const result = await query<SchemaRow>(
    `SELECT
       EXISTS (
         SELECT 1
           FROM public.schema_migrations
          WHERE filename = $1
       ) AS migration_applied,
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
       EXISTS (
         SELECT 1
           FROM pg_class relation
           JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public'
            AND relation.relname = 'game_takeback_requests'
            AND relation.relrowsecurity
       ) AS takeback_rls`,
    [JAPANESE_RULES_MIGRATION],
  );

  const row = result.rows[0];
  if (!row) throw new Error("Production schema check returned no result.");

  validateProductionSchemaContract({
    migrationApplied: row.migration_applied,
    gameRulesDefault: row.game_rules_default,
    gameRulesProfileDefault: row.game_rules_profile_default,
    gameScoringMethodDefault: row.game_scoring_method_default,
    gameKomiDefault: row.game_komi_default,
    queueRulesProfileDefault: row.queue_rules_profile_default,
    queueProfileConstraint: row.queue_profile_constraint,
    queueAdaptiveConstraint: row.queue_adaptive_constraint,
    takebackRls: row.takeback_rls,
  });

  console.log("Production matchmaking and Japanese scoring schema is current.");
}

checkProductionSchema()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
