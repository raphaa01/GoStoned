import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import "dotenv/config";
import { closePool, getPool, query } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import {
  assertSmokeDatabaseIdentity,
  getSmokeDatabaseExpectation,
} from "../lib/smokeDatabase";

const NONTRANSACTIONAL_INDEXES = {
  "012_leaderboard_rating_history_index.sql": {
    name: "idx_player_rating_history_board_player_time",
    fragments: [
      "ON public.player_rating_history USING btree (board_size, player_key, recorded_at, id)",
      "INCLUDE (game_id, rating_before, rating_after, result)",
    ],
  },
  "015_matchmaking_stale_cleanup_index.sql": {
    name: "idx_matchmaking_waiting_pool_updated_at",
    fragments: [
      "ON public.matchmaking_queue USING btree (board_size, time_control, rules_profile, updated_at, player_key)",
      "WHERE (status = 'waiting'::text)",
    ],
  },
} as const;

type MigrationSnapshot = Readonly<{
  databaseName: string;
  roleName: string;
  migrations: ReadonlyArray<Readonly<{ filename: string; appliedAt: string }>>;
  indexes: ReadonlyArray<Readonly<{
    name: string;
    definition: string;
    ready: boolean;
    valid: boolean;
  }>>;
}>;

async function expectedMigrationFiles(): Promise<string[]> {
  const migrationsPath = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(migrationsPath))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  assert.ok(files.length > 0, "No numbered migrations were found.");
  for (const [index, filename] of files.entries()) {
    assert.match(filename, /^\d{3}_[a-z0-9_]+\.sql$/, "Invalid migration filename.");
    assert.equal(filename.slice(0, 3), String(index + 1).padStart(3, "0"), "Migration numbers must be contiguous.");
  }

  const nonTransactional: string[] = [];
  for (const filename of files) {
    const sql = await readFile(path.join(migrationsPath, filename), "utf8");
    if (sql.trimStart().startsWith("-- gostone:migration-mode=nontransactional")) {
      nonTransactional.push(filename);
    }
  }
  assert.deepEqual(nonTransactional, Object.keys(NONTRANSACTIONAL_INDEXES));
  return files;
}

function runMigrations(): string {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["run", "db:migrate"], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 2 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) throw new Error("Database migration command failed.");
  return result.stdout;
}

async function snapshot(expectedFiles: readonly string[]): Promise<MigrationSnapshot> {
  await assertSmokeDatabaseIdentity(getPool());
  const expected = getSmokeDatabaseExpectation();
  const identity = await query<{
    database_name: string;
    role_name: string;
    owner_name: string;
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
  }>(
    `SELECT current_database() AS database_name,
            current_user AS role_name,
            pg_get_userbyid(database.datdba) AS owner_name,
            role.rolcanlogin,
            role.rolsuper,
            role.rolcreatedb,
            role.rolcreaterole,
            role.rolreplication,
            role.rolbypassrls
       FROM pg_database AS database
       JOIN pg_roles AS role ON role.rolname = current_user
      WHERE database.datname = current_database()`,
  );
  assert.equal(identity.rows.length, 1, "Migration smoke identity check failed.");
  const connected = identity.rows[0];
  assert.equal(connected.database_name, expected.databaseName, "Migration smoke identity check failed.");
  assert.equal(connected.role_name, expected.roleName, "Migration smoke identity check failed.");
  assert.equal(connected.owner_name, expected.roleName, "Migration smoke owner check failed.");
  assert.equal(connected.rolcanlogin, true, "Migration smoke role check failed.");
  assert.equal(connected.rolsuper, false, "Migration smoke role check failed.");
  assert.equal(connected.rolcreatedb, false, "Migration smoke role check failed.");
  assert.equal(connected.rolcreaterole, false, "Migration smoke role check failed.");
  assert.equal(connected.rolreplication, false, "Migration smoke role check failed.");
  assert.equal(connected.rolbypassrls, false, "Migration smoke role check failed.");

  const clientRoles = await query<{
    role_name: string;
    rolcanlogin: boolean;
    rolsuper: boolean;
  }>(
    `SELECT rolname AS role_name, rolcanlogin, rolsuper
       FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated')
      ORDER BY rolname`,
  );
  assert.deepEqual(clientRoles.rows, [
    { role_name: "anon", rolcanlogin: false, rolsuper: false },
    { role_name: "authenticated", rolcanlogin: false, rolsuper: false },
  ]);

  const ledger = await query<{ filename: string; applied_at: Date }>(
    "SELECT filename, applied_at FROM schema_migrations ORDER BY filename",
  );
  assert.deepEqual(ledger.rows.map(({ filename }) => filename), expectedFiles);

  const indexNames = Object.values(NONTRANSACTIONAL_INDEXES).map(({ name }) => name);
  const indexes = await query<{
    name: string;
    definition: string;
    ready: boolean;
    valid: boolean;
  }>(
    `SELECT relation.relname AS name,
            pg_get_indexdef(indexes.indexrelid) AS definition,
            indexes.indisready AS ready,
            indexes.indisvalid AS valid
       FROM pg_index AS indexes
       JOIN pg_class AS relation ON relation.oid = indexes.indexrelid
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = ANY($1::text[])
      ORDER BY relation.relname`,
    [indexNames],
  );
  assert.deepEqual(indexes.rows.map(({ name }) => name), [...indexNames].sort());
  for (const index of indexes.rows) {
    const expectedIndex = Object.values(NONTRANSACTIONAL_INDEXES).find(({ name }) => name === index.name);
    assert.ok(expectedIndex, "Unexpected concurrent index.");
    assert.equal(index.ready, true, "Concurrent index is not ready.");
    assert.equal(index.valid, true, "Concurrent index is not valid.");
    for (const fragment of expectedIndex.fragments) assert.ok(index.definition.includes(fragment));
  }

  return {
    databaseName: connected.database_name,
    roleName: connected.role_name,
    migrations: ledger.rows.map(({ filename, applied_at }) => ({
      filename,
      appliedAt: applied_at.toISOString(),
    })),
    indexes: indexes.rows,
  };
}

async function run(): Promise<void> {
  if (!isUnambiguousLocalDatabase(getDatabaseUrl())) {
    throw new Error("Migration smoke requires an unambiguous local database.");
  }
  const expectedFiles = await expectedMigrationFiles();
  const verifyOnly = process.argv.includes("--verify-only");
  await assertSmokeDatabaseIdentity(getPool());
  if (!verifyOnly) {
    const empty = await query<{ schema_migrations: string | null }>(
      "SELECT to_regclass('public.schema_migrations')::text AS schema_migrations",
    );
    assert.equal(empty.rows[0].schema_migrations, null, "Migration smoke database is not fresh.");
    await closePool();

    const firstOutput = runMigrations();
    for (const filename of expectedFiles) assert.ok(firstOutput.includes(`Applying ${filename}...`));
    const first = await snapshot(expectedFiles);
    await closePool();

    const secondOutput = runMigrations();
    assert.equal(secondOutput.includes("Applying "), false, "Migration rerun attempted to apply a file.");
    for (const filename of expectedFiles) {
      assert.ok(secondOutput.includes(`Skipping ${filename} (already applied).`));
    }
    const second = await snapshot(expectedFiles);
    assert.deepEqual(second, first, "Migration rerun changed the verified schema state.");
  }

  const verified = await snapshot(expectedFiles);
  const fingerprint = createHash("sha256").update(JSON.stringify(verified)).digest("hex").slice(0, 16);
  console.log(
    `Verified ${verified.migrations.length} migrations and ${verified.indexes.length} concurrent indexes (${fingerprint}).`,
  );
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Migration smoke failed.");
    process.exitCode = 1;
  })
  .finally(closePool);
