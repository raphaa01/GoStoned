import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { closePool, getPool } from "../lib/db";
import { getDatabaseUrl } from "../lib/env";
import {
  assertMigrationSessionEndpoint,
  classifyConcurrentIndex,
  inspectConcurrentIndex,
  MIGRATION_LOCK_NAMESPACE,
  MIGRATION_LOCK_PURPOSE,
  releaseMigrationSession,
  type ConcurrentIndexSpec,
  validateMigrationIndexContract,
} from "./migrationIndexes";

const MIGRATION_LOCK_TIMEOUT_MS = 60_000;
const MIGRATION_LOCK_POLL_MS = 250;

type MigrationFile = Readonly<{
  filename: string;
  sql: string;
  nonTransactional: boolean;
  indexSpec: ConcurrentIndexSpec | undefined;
}>;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function setTrustedSearchPath(client: PoolClient): Promise<void> {
  await client.query("SET search_path TO public");
  const result = await client.query<{ schemas: string }>(
    "SELECT pg_catalog.current_schemas(FALSE)::text AS schemas",
  );
  if (result.rows.length !== 1 || result.rows[0].schemas !== "{public}") {
    throw new Error("Migration search path could not be secured.");
  }
}

async function acquireMigrationLock(client: PoolClient): Promise<void> {
  const deadline = Date.now() + MIGRATION_LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_catalog.pg_try_advisory_lock($1::int, $2::int) AS locked",
      [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_PURPOSE],
    );
    if (result.rows[0]?.locked === true) return;
    await wait(MIGRATION_LOCK_POLL_MS);
  }
  throw new Error("Another database migration is still running.");
}

async function readMigrationFiles(migrationsPath: string): Promise<MigrationFile[]> {
  const filenames = (await readdir(migrationsPath))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const files: MigrationFile[] = [];
  for (const filename of filenames) {
    const sql = await readFile(path.join(migrationsPath, filename), "utf8");
    const indexSpec = validateMigrationIndexContract(filename, sql);
    const nonTransactional = Boolean(indexSpec);
    files.push({ filename, sql, nonTransactional, indexSpec });
  }
  return files;
}

async function initializeLedger(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON public.schema_migrations FROM anon;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON public.schema_migrations FROM authenticated;
      END IF;
    END
    $$;
  `);
}

async function recordMigration(client: PoolClient, filename: string): Promise<void> {
  await client.query(
    "INSERT INTO public.schema_migrations (filename) VALUES ($1)",
    [filename],
  );
}

async function reconcileConcurrentIndex(
  client: PoolClient,
  migration: MigrationFile,
  alreadyApplied: boolean,
  currentUser: string,
): Promise<void> {
  const spec = migration.indexSpec;
  if (!spec) throw new Error(`Missing concurrent index contract for ${migration.filename}.`);
  let inspection = await inspectConcurrentIndex(client, spec);
  let classification = classifyConcurrentIndex(inspection, spec, currentUser);

  if (classification.state === "conflict") {
    throw new Error(
      `Concurrent index conflict for ${migration.filename}: ${classification.reason}.`,
    );
  }
  if (classification.state === "exact-valid") {
    if (alreadyApplied) {
      console.log(`Skipping ${migration.filename} (already applied).`);
      return;
    }
    console.log(`Applying ${migration.filename}...`);
    await recordMigration(client, migration.filename);
    console.log(`Applied ${migration.filename}.`);
    return;
  }

  console.log(`${alreadyApplied ? "Repairing" : "Applying"} ${migration.filename}...`);
  if (classification.state === "exact-invalid") {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout = '15s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query(spec.recoveryLockSql);
      const confirmed = await inspectConcurrentIndex(client, spec);
      const confirmedClassification = classifyConcurrentIndex(confirmed, spec, currentUser);
      if (
        confirmedClassification.state !== "exact-invalid"
        || !confirmed
        || confirmed.relationOid !== inspection?.relationOid
      ) {
        throw new Error(`Concurrent index state changed before recovery for ${migration.filename}.`);
      }
      const quarantineSpec = { ...spec, name: spec.recoveryQuarantineName };
      if (await inspectConcurrentIndex(client, quarantineSpec)) {
        throw new Error(`Concurrent index recovery name is occupied for ${migration.filename}.`);
      }
      await client.query(spec.recoveryRenameSql);
      const quarantined = await inspectConcurrentIndex(client, quarantineSpec);
      const quarantinedClassification = classifyConcurrentIndex(
        quarantined,
        quarantineSpec,
        currentUser,
      );
      if (
        quarantinedClassification.state !== "exact-invalid"
        || !quarantined
        || quarantined.relationOid !== confirmed.relationOid
      ) {
        throw new Error(`Concurrent index identity changed during recovery for ${migration.filename}.`);
      }
      await client.query(spec.recoveryDropSql);
      const removedOriginal = await inspectConcurrentIndex(client, spec);
      const removedQuarantine = await inspectConcurrentIndex(client, quarantineSpec);
      if (removedOriginal || removedQuarantine) {
        throw new Error(`Concurrent index cleanup failed for ${migration.filename}.`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  await client.query(migration.sql);
  inspection = await inspectConcurrentIndex(client, spec);
  classification = classifyConcurrentIndex(inspection, spec, currentUser);
  if (classification.state !== "exact-valid") {
    throw new Error(
      `Concurrent index verification failed for ${migration.filename}: ${classification.reason}.`,
    );
  }
  if (!alreadyApplied) await recordMigration(client, migration.filename);
  console.log(`${alreadyApplied ? "Repaired" : "Applied"} ${migration.filename}.`);
}

async function migrate() {
  const migrationsPath = path.join(process.cwd(), "db", "migrations");
  console.log("GoStone database migration");
  console.log(`Reading migrations: ${migrationsPath}`);

  const migrations = await readMigrationFiles(migrationsPath);
  assertMigrationSessionEndpoint(getDatabaseUrl());
  const pool = getPool();
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await setTrustedSearchPath(client);
    await acquireMigrationLock(client);
    lockAcquired = true;
    await initializeLedger(client);
    const currentUserResult = await client.query<{ currentUser: string }>(
      "SELECT current_user AS \"currentUser\"",
    );
    const currentUser = currentUserResult.rows[0]?.currentUser;
    if (!currentUser) throw new Error("Migration role identity could not be verified.");

    for (const migration of migrations) {
      const alreadyApplied = await client.query(
        "SELECT 1 FROM public.schema_migrations WHERE filename = $1",
        [migration.filename],
      );
      if (migration.nonTransactional) {
        await reconcileConcurrentIndex(
          client,
          migration,
          Boolean(alreadyApplied.rowCount),
          currentUser,
        );
        continue;
      }

      if (alreadyApplied.rowCount) {
        console.log(`Skipping ${migration.filename} (already applied).`);
        continue;
      }
      console.log(`Applying ${migration.filename}...`);
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await recordMigration(client, migration.filename);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      console.log(`Applied ${migration.filename}.`);
    }
    console.log("Database migrations completed successfully.");
  } finally {
    await releaseMigrationSession(client, lockAcquired);
  }
}

migrate()
  .catch((error: unknown) => {
    console.error("Migration failed.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
