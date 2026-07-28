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
import {
  assertExactUsableConcurrentIndex,
  CONCURRENT_INDEX_SPECS,
} from "./migrationIndexes";

type MigrationSnapshot = Readonly<{
  databaseName: string;
  roleName: string;
  activeStatementTimeout: string;
  databaseRoleSettings: readonly string[];
  migrations: ReadonlyArray<Readonly<{ filename: string; appliedAt: string }>>;
  indexes: ReadonlyArray<Readonly<{
    relationOid: number;
    name: string;
    relationPersistence: string;
    tablespaceOid: number;
    relationOptions: string[] | null;
    ownerName: string;
    tableSchema: string | null;
    tableName: string | null;
    tableOid: number | null;
    tableKind: string | null;
    tableOwnerName: string | null;
    method: string | null;
    keyExpressions: string[] | null;
    includeExpressions: string[] | null;
    predicate: string | null;
    ready: boolean;
    valid: boolean;
    live: boolean;
    constraintCount: number;
    activeBuildCount: number;
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
  assert.deepEqual(nonTransactional, CONCURRENT_INDEX_SPECS.map(({ filename }) => filename));
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
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const databaseUrl = getDatabaseUrl();
  const encodedPassword = new URL(databaseUrl).password;
  const decodedPassword = decodeURIComponent(encodedPassword);
  assert.equal(output.includes(databaseUrl), false, "Migration output exposed DATABASE_URL.");
  if (encodedPassword) {
    assert.equal(output.includes(encodedPassword), false, "Migration output exposed a password.");
  }
  if (decodedPassword) {
    assert.equal(output.includes(decodedPassword), false, "Migration output exposed a password.");
  }
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
    session_role: string;
    owner_name: string;
    active_statement_timeout: string;
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
  }>(
    `SELECT current_database() AS database_name,
            current_user AS role_name,
            session_user AS session_role,
            pg_get_userbyid(database.datdba) AS owner_name,
            pg_catalog.current_setting('statement_timeout') AS active_statement_timeout,
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
  assert.equal(connected.session_role, expected.roleName, "Migration smoke identity check failed.");
  assert.equal(connected.owner_name, expected.roleName, "Migration smoke owner check failed.");
  assert.equal(connected.active_statement_timeout, "8s", "Database statement timeout is not active.");
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

  const databaseRoleConfig = await query<{ settings: string[] }>(
    `SELECT setting.setconfig AS settings
       FROM pg_catalog.pg_db_role_setting AS setting
       JOIN pg_catalog.pg_database AS database ON database.oid = setting.setdatabase
       JOIN pg_catalog.pg_roles AS role ON role.oid = setting.setrole
      WHERE database.datname = current_database()
        AND role.rolname = current_user`,
  );
  assert.equal(databaseRoleConfig.rows.length, 1, "Database-role defaults are not canonical.");
  const databaseRoleSettings = [...databaseRoleConfig.rows[0].settings].sort();
  assert.deepEqual(
    databaseRoleSettings.filter((setting) => setting.startsWith("statement_timeout=")),
    ["statement_timeout=8s"],
    "Database statement timeout is not scoped to the migration role and database.",
  );

  const ledger = await query<{ filename: string; applied_at: Date }>(
    "SELECT filename, applied_at FROM public.schema_migrations ORDER BY filename",
  );
  assert.deepEqual(ledger.rows.map(({ filename }) => filename), expectedFiles);

  const indexes: Array<MigrationSnapshot["indexes"][number]> = [];
  for (const spec of CONCURRENT_INDEX_SPECS) {
    const inspection = await assertExactUsableConcurrentIndex(getPool(), spec, connected.role_name);
    assert.equal(inspection.ready, true, "Concurrent index is not ready.");
    assert.equal(inspection.valid, true, "Concurrent index is not valid.");
    assert.equal(inspection.live, true, "Concurrent index is not live.");
    indexes.push({
      relationOid: inspection.relationOid,
      name: spec.name,
      relationPersistence: inspection.relationPersistence,
      tablespaceOid: inspection.tablespaceOid,
      relationOptions: inspection.relationOptions,
      ownerName: inspection.ownerName,
      tableSchema: inspection.tableSchema,
      tableName: inspection.tableName,
      tableOid: inspection.tableOid,
      tableKind: inspection.tableKind,
      tableOwnerName: inspection.tableOwnerName,
      method: inspection.method,
      keyExpressions: inspection.keyExpressions,
      includeExpressions: inspection.includeExpressions,
      predicate: inspection.predicate,
      ready: inspection.ready,
      valid: inspection.valid,
      live: inspection.live,
      constraintCount: inspection.constraintCount,
      activeBuildCount: inspection.activeBuildCount,
    });
  }

  return {
    databaseName: connected.database_name,
    roleName: connected.role_name,
    activeStatementTimeout: connected.active_statement_timeout,
    databaseRoleSettings,
    migrations: ledger.rows.map(({ filename, applied_at }) => ({
      filename,
      appliedAt: applied_at.toISOString(),
    })),
    indexes,
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
