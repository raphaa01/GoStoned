import "dotenv/config";
import { closePool, query } from "../lib/db";
import { isLocalDatabase } from "../lib/env";

const requiredVariables = [
  "DATABASE_URL",
  "NEXT_PUBLIC_APP_URL",
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
  "player_stats",
  "player_rating_history",
  "game_scoring_state",
  "game_dead_stones",
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

async function checkMvp() {
  console.log("GoStone production preflight");

  const missing = requiredVariables.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
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
            (
              SELECT column_default
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'games'
                 AND column_name = 'rules_profile'
            ) AS rules_profile_default`,
    [requiredTables, requiredGameColumns, requiredScoringColumns],
  );

  const row = database.rows[0];
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
