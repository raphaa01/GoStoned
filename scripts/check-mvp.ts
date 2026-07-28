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
  }>(
    `SELECT NOW() AS now,
            (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl,
            ARRAY(
              SELECT table_name
                FROM information_schema.tables
               WHERE table_schema = 'public'
                 AND table_name = ANY($1::text[])
               ORDER BY table_name
            ) AS tables`,
    [requiredTables],
  );

  const row = database.rows[0];
  const absentTables = requiredTables.filter((table) => !row.tables.includes(table));
  if (absentTables.length > 0) {
    throw new Error(
      `Database migrations are incomplete. Missing tables: ${absentTables.join(", ")}`,
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
