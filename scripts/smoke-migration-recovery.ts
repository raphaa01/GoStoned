import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import "dotenv/config";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { closePool, getPool } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity, getSmokeDatabaseExpectation } from "../lib/smokeDatabase";
import {
  assertExactUsableConcurrentIndex,
  classifyConcurrentIndex,
  CONCURRENT_INDEX_SPECS,
  inspectConcurrentIndex,
  MIGRATION_LOCK_NAMESPACE,
  MIGRATION_LOCK_PURPOSE,
  type ConcurrentIndexSpec,
} from "./migrationIndexes";

const CHILD_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 15_000;
const OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;
const HOSTILE_SCHEMA = "gostone_migration_hostile";

type MigrationResult = Readonly<{
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  harnessError: string | null;
}>;

type RunningMigration = Readonly<{
  child: ChildProcessByStdio<null, Readable, Readable>;
  completion: Promise<MigrationResult>;
}>;

let smokeClient: PoolClient | undefined;

function database(): PoolClient {
  if (!smokeClient) throw new Error("Migration recovery smoke database is not initialized.");
  return smokeClient;
}

function smokeQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return database().query<T>(text, [...values]);
}

async function configureSmokeClient(client: PoolClient): Promise<void> {
  await assertSmokeDatabaseIdentity(client);
  await client.query(`SET statement_timeout = '20s';
                      SET lock_timeout = '5s';
                      SET idle_in_transaction_session_timeout = '45s'`);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function firstFailure(current: unknown, next: unknown): unknown {
  return current ?? next;
}

async function pollUntil(operation: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await operation()) return;
    await wait(100);
  }
  throw new Error(message);
}

function childDatabaseUrl(applicationName: string): string {
  const url = new URL(getDatabaseUrl());
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

function startMigration(applicationName: string, pgOptions?: string): RunningMigration {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/migrate.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_POOL_MAX: "1",
        DATABASE_URL: childDatabaseUrl(applicationName),
        ...(pgOptions ? { PGOPTIONS: pgOptions } : {}),
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let outputExceeded = false;
  const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
    const remaining = OUTPUT_LIMIT_BYTES - Buffer.byteLength(stdout) - Buffer.byteLength(stderr);
    if (remaining > 0) {
      const text = chunk.subarray(0, remaining).toString("utf8");
      if (target === "stdout") stdout += text;
      else stderr += text;
    }
    if (chunk.byteLength > remaining) {
      outputExceeded = true;
      child.kill("SIGTERM");
    }
  };
  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));

  const completion = new Promise<MigrationResult>((resolve) => {
    let settled = false;
    const hardTimeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 5_000).unref();
    }, CHILD_TIMEOUT_MS);
    const finish = (status: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      if (outputExceeded) {
        resolve({
          status,
          stdout,
          stderr,
          timedOut,
          harnessError: "Migration child exceeded its output limit.",
        });
        return;
      }
      resolve({ status, stdout, stderr, timedOut, harnessError: null });
    };
    child.once("error", (error) => {
      clearTimeout(hardTimeout);
      if (!settled) {
        settled = true;
        resolve({
          status: null,
          stdout,
          stderr,
          timedOut,
          harnessError: `Migration child could not start: ${error.message}`,
        });
      }
    });
    child.once("close", finish);
  });
  return { child, completion };
}

function assertNoCredentialLeak(result: MigrationResult): void {
  const databaseUrl = getDatabaseUrl();
  const encodedPassword = new URL(databaseUrl).password;
  const password = decodeURIComponent(encodedPassword);
  const output = result.stdout + result.stderr;
  assert.equal(output.includes(databaseUrl), false, "Migration output exposed DATABASE_URL.");
  if (encodedPassword) {
    assert.equal(output.includes(encodedPassword), false, "Migration output exposed a password.");
  }
  if (password) assert.equal(output.includes(password), false, "Migration output exposed a password.");
}

async function finishMigration(
  running: RunningMigration,
  expected: "success" | "failure",
): Promise<MigrationResult> {
  const result = await running.completion;
  assertNoCredentialLeak(result);
  if (result.harnessError) throw new Error(result.harnessError);
  assert.equal(result.timedOut, false, "Migration child timed out.");
  const succeeded = result.status === 0;
  if (succeeded !== (expected === "success")) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    assert.fail(`Migration child unexpectedly ${succeeded ? "succeeded" : "failed"}.`);
  }
  return result;
}

async function runMigration(
  applicationName: string,
  expected: "success" | "failure" = "success",
  pgOptions?: string,
): Promise<MigrationResult> {
  return finishMigration(startMigration(applicationName, pgOptions), expected);
}

async function ledgerCount(filename: string): Promise<number> {
  const result = await smokeQuery<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM public.schema_migrations WHERE filename = $1",
    [filename],
  );
  return result.rows[0].count;
}

async function currentRole(): Promise<string> {
  const result = await smokeQuery<{ role_name: string }>("SELECT current_user AS role_name");
  return result.rows[0].role_name;
}

async function exactIndex(spec: ConcurrentIndexSpec) {
  return assertExactUsableConcurrentIndex(database(), spec, await currentRole());
}

async function dropIndex(spec: ConcurrentIndexSpec): Promise<void> {
  await assertSmokeDatabaseIdentity(database());
  const state = await inspectConcurrentIndex(database(), spec);
  const classification = classifyConcurrentIndex(state, spec, await currentRole());
  assert.ok(
    classification.state === "exact-valid" || classification.state === "exact-invalid",
    `Refusing to drop an unsafe ${spec.filename} fixture.`,
  );
  await smokeQuery(spec.concurrentDropSql);
}

async function dropCreatedIndex(spec: ConcurrentIndexSpec, expectedOid: number): Promise<void> {
  await assertSmokeDatabaseIdentity(database());
  const state = await inspectConcurrentIndex(database(), spec);
  assert.equal(state?.relationOid, expectedOid, "Test index identity changed before cleanup.");
  await smokeQuery(spec.concurrentDropSql);
}

async function assertCanonical(spec: ConcurrentIndexSpec): Promise<void> {
  assert.equal(await ledgerCount(spec.filename), 1, `${spec.filename} ledger is not canonical.`);
  await exactIndex(spec);
}

async function verifyTransactionalDropRollback(
  spec: ConcurrentIndexSpec,
  expectedOid: number,
): Promise<void> {
  const probe = await getPool().connect();
  let transactionOpen = false;
  let destroyProbe = false;
  try {
    await configureSmokeClient(probe);
    await probe.query("BEGIN");
    transactionOpen = true;
    await probe.query(spec.recoveryLockSql);
    const beforeDrop = await inspectConcurrentIndex(probe, spec);
    assert.equal(beforeDrop?.relationOid, expectedOid, "Rollback probe found a different invalid index.");
    const quarantineSpec = { ...spec, name: spec.recoveryQuarantineName };
    assert.equal(
      await inspectConcurrentIndex(probe, quarantineSpec),
      null,
      "Rollback probe recovery name is occupied.",
    );
    await probe.query(spec.recoveryRenameSql);
    const quarantined = await inspectConcurrentIndex(probe, quarantineSpec);
    assert.equal(quarantined?.relationOid, expectedOid, "Rollback probe renamed a different index.");
    await probe.query(spec.recoveryDropSql);
    assert.equal(
      await inspectConcurrentIndex(probe, quarantineSpec),
      null,
      "Transactional recovery drop did not remove the index inside its transaction.",
    );
    assert.equal(await inspectConcurrentIndex(probe, spec), null);
    await probe.query("ROLLBACK");
    transactionOpen = false;
    const restored = await inspectConcurrentIndex(database(), spec);
    assert.equal(restored?.relationOid, expectedOid, "Rollback did not restore the invalid index OID.");
  } finally {
    if (transactionOpen) {
      try {
        await probe.query("ROLLBACK");
      } catch {
        destroyProbe = true;
      }
    }
    probe.release(destroyProbe);
  }
}

async function relationOid(name: string): Promise<number | null> {
  const result = await smokeQuery<{ oid: number | null }>(
    "SELECT pg_catalog.to_regclass($1)::oid::int AS oid",
    [`public.${name}`],
  );
  return result.rows[0].oid;
}

async function verifyQuarantineRejectsStaleOid(
  spec: ConcurrentIndexSpec,
  expectedOid: number,
): Promise<void> {
  const sourceName = "gostone_migration_swap_source";
  const savedName = "gostone_migration_swap_saved";
  for (const name of [sourceName, savedName, spec.recoveryQuarantineName]) {
    assert.equal(await relationOid(name), null, `Name-swap fixture ${name} already exists.`);
  }
  let sourceOid: number | undefined;
  const probe = await getPool().connect();
  let transactionOpen = false;
  let destroyProbe = false;
  try {
    await smokeQuery("CREATE INDEX CONCURRENTLY gostone_migration_swap_source ON public.games(id)");
    sourceOid = await relationOid(sourceName) ?? undefined;
    assert.ok(sourceOid, "Name-swap source index was not created.");
    await smokeQuery(`ALTER INDEX public.idx_matchmaking_waiting_pool_updated_at
                        RENAME TO gostone_migration_swap_saved`);
    await smokeQuery(`ALTER INDEX public.gostone_migration_swap_source
                        RENAME TO idx_matchmaking_waiting_pool_updated_at`);
    assert.equal(await relationOid(spec.name), sourceOid, "Name-swap fixture did not occupy the target.");
    assert.equal(await relationOid(savedName), expectedOid, "Invalid index was not saved for the fixture.");

    await configureSmokeClient(probe);
    await probe.query("BEGIN");
    transactionOpen = true;
    await probe.query(spec.recoveryLockSql);
    await probe.query(spec.recoveryRenameSql);
    const quarantineOid = await relationOidOnClient(probe, spec.recoveryQuarantineName);
    assert.notEqual(quarantineOid, expectedOid, "Name-swap fixture unexpectedly retained the stale OID.");
    await probe.query("ROLLBACK");
    transactionOpen = false;
    assert.equal(await relationOid(spec.name), sourceOid, "Stale-OID rejection did not roll back the rename.");
    assert.equal(await relationOid(savedName), expectedOid, "Stale-OID rejection changed the invalid index.");
  } finally {
    if (transactionOpen) {
      try {
        await probe.query("ROLLBACK");
      } catch {
        destroyProbe = true;
      }
    }
    probe.release(destroyProbe);
    const targetOid = await relationOid(spec.name);
    const savedOid = await relationOid(savedName);
    const quarantineOid = await relationOid(spec.recoveryQuarantineName);
    if (sourceOid !== undefined && savedOid === expectedOid) {
      if (targetOid === sourceOid) {
        await smokeQuery(`ALTER INDEX public.idx_matchmaking_waiting_pool_updated_at
                            RENAME TO gostone_migration_swap_source`);
      } else if (quarantineOid === sourceOid) {
        await smokeQuery(`ALTER INDEX public.gostone_migration_recovery_015
                            RENAME TO gostone_migration_swap_source`);
      } else {
        assert.equal(targetOid, null, "Name-swap cleanup found an unexpected target relation.");
        assert.equal(await relationOid(sourceName), sourceOid, "Name-swap source identity changed.");
      }
      await smokeQuery(`ALTER INDEX public.gostone_migration_swap_saved
                          RENAME TO idx_matchmaking_waiting_pool_updated_at`);
    }
    assert.equal(await relationOid(spec.name), expectedOid, "Name-swap cleanup did not restore the invalid index.");
    assert.equal(await relationOid(savedName), null, "Name-swap saved name was not released.");
    assert.equal(
      await relationOid(spec.recoveryQuarantineName),
      null,
      "Name-swap quarantine name was not released.",
    );
    if (sourceOid !== undefined) {
      assert.equal(await relationOid(sourceName), sourceOid, "Name-swap source identity changed.");
      await smokeQuery("DROP INDEX CONCURRENTLY public.gostone_migration_swap_source");
    }
  }
}

async function relationOidOnClient(client: PoolClient, name: string): Promise<number | null> {
  const result = await client.query<{ oid: number | null }>(
    "SELECT pg_catalog.to_regclass($1)::oid::int AS oid",
    [`public.${name}`],
  );
  return result.rows[0].oid;
}

async function verifySerializedAdoption(): Promise<void> {
  const spec = CONCURRENT_INDEX_SPECS[0];
  const before = await exactIndex(spec);
  await smokeQuery("DELETE FROM public.schema_migrations WHERE filename = $1", [spec.filename]);
  const holder = await getPool().connect();
  let holderLocked = false;
  let first: RunningMigration | undefined;
  let second: RunningMigration | undefined;
  try {
    await configureSmokeClient(holder);
    const acquired = await holder.query<{ locked: boolean }>(
      "SELECT pg_catalog.pg_try_advisory_lock($1::int, $2::int) AS locked",
      [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_PURPOSE],
    );
    assert.equal(acquired.rows[0].locked, true, "Smoke could not hold the migration lock.");
    holderLocked = true;
    first = startMigration("gostone_migration_serial_a");
    second = startMigration("gostone_migration_serial_b");
    await pollUntil(async () => {
      const connected = await smokeQuery<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM pg_catalog.pg_stat_activity
          WHERE application_name = ANY($1::text[])
            AND pid <> pg_backend_pid()`,
        [["gostone_migration_serial_a", "gostone_migration_serial_b"]],
      );
      return connected.rows[0].count === 2;
    }, "Concurrent migration children did not both reach PostgreSQL.");
    await wait(500);
    assert.equal(first.child.exitCode, null, "First migrator escaped the held lock.");
    assert.equal(second.child.exitCode, null, "Second migrator escaped the held lock.");
    assert.equal(await ledgerCount(spec.filename), 0, "A migrator mutated the ledger without the lock.");
    const unlocked = await holder.query<{ unlocked: boolean }>(
      "SELECT pg_catalog.pg_advisory_unlock($1::int, $2::int) AS unlocked",
      [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_PURPOSE],
    );
    assert.equal(unlocked.rows[0].unlocked, true, "Smoke could not release the migration lock.");
    holderLocked = false;
    const [firstResult, secondResult] = await Promise.all([
      finishMigration(first, "success"),
      finishMigration(second, "success"),
    ]);
    const combined = firstResult.stdout + secondResult.stdout;
    assert.equal(
      combined.split(`Applying ${spec.filename}...`).length - 1,
      1,
      "The orphaned index was not adopted exactly once.",
    );
    assert.equal(
      combined.split(`Skipping ${spec.filename} (already applied).`).length - 1,
      1,
      "The serialized follower did not observe the ledger.",
    );
    const after = await exactIndex(spec);
    assert.equal(after.relationOid, before.relationOid, "Valid orphan adoption rebuilt the index.");
    assert.equal(await ledgerCount(spec.filename), 1, "Valid orphan adoption did not restore one row.");
  } finally {
    let cleanupFailure: unknown;
    let destroyHolder = false;
    if (holderLocked) {
      try {
        const unlocked = await holder.query<{ unlocked: boolean }>(
          "SELECT pg_catalog.pg_advisory_unlock($1::int, $2::int) AS unlocked",
          [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_PURPOSE],
        );
        assert.equal(unlocked.rows[0].unlocked, true, "Smoke could not release the migration lock.");
      } catch (error) {
        destroyHolder = true;
        cleanupFailure = firstFailure(cleanupFailure, error);
      }
    }
    try {
      holder.release(destroyHolder);
    } catch (error) {
      cleanupFailure = firstFailure(cleanupFailure, error);
    }
    for (const running of [first, second]) {
      try {
        if (running && running.child.exitCode === null && running.child.signalCode === null) {
          running.child.kill("SIGKILL");
        }
        if (running) await running.completion;
      } catch (error) {
        cleanupFailure = firstFailure(cleanupFailure, error);
      }
    }
    if (cleanupFailure) throw cleanupFailure;
  }
}

async function verifySecondOrphanAdoption(): Promise<void> {
  const spec = CONCURRENT_INDEX_SPECS[1];
  const before = await exactIndex(spec);
  await smokeQuery("DELETE FROM public.schema_migrations WHERE filename = $1", [spec.filename]);
  await runMigration("gostone_migration_adopt_015");
  const after = await exactIndex(spec);
  assert.equal(after.relationOid, before.relationOid, "Valid orphan adoption rebuilt migration 015.");
  assert.equal(await ledgerCount(spec.filename), 1);
}

async function verifyWrongDefinitionPreserved(): Promise<void> {
  const spec = CONCURRENT_INDEX_SPECS[0];
  let wrongCreated = false;
  let wrongOid: number | undefined;
  await smokeQuery("DELETE FROM public.schema_migrations WHERE filename = $1", [spec.filename]);
  await dropIndex(spec);
  try {
    await smokeQuery(`CREATE INDEX CONCURRENTLY idx_player_rating_history_board_player_time
                   ON public.player_rating_history(board_size, player_key, recorded_at, id)
                   INCLUDE (game_id, rating_before, rating_after, result)
                   WHERE FALSE`);
    wrongCreated = true;
    const wrong = await inspectConcurrentIndex(database(), spec);
    assert.ok(wrong, "Wrong-definition fixture was not created.");
    wrongOid = wrong.relationOid;
    await runMigration("gostone_migration_wrong_definition", "failure");
    const preserved = await inspectConcurrentIndex(database(), spec);
    assert.equal(preserved?.relationOid, wrong.relationOid, "Conflicting index was replaced.");
    assert.equal(await ledgerCount(spec.filename), 0, "Conflicting index was adopted.");
  } finally {
    if (wrongCreated) {
      const fixture = await inspectConcurrentIndex(database(), spec);
      assert.ok(fixture, "Wrong-definition fixture disappeared before cleanup.");
      if (wrongOid !== undefined) {
        assert.equal(fixture.relationOid, wrongOid, "Wrong-definition fixture identity changed.");
      }
      assert.notEqual(fixture.predicate, spec.predicate, "Wrong-definition fixture became canonical.");
      await dropCreatedIndex(spec, fixture.relationOid);
    }
    if (await ledgerCount(spec.filename)) {
      await smokeQuery("DELETE FROM public.schema_migrations WHERE filename = $1", [spec.filename]);
    }
    await runMigration("gostone_migration_restore_012_definition");
  }
}

async function verifySameNameTablePreserved(): Promise<void> {
  const spec = CONCURRENT_INDEX_SPECS[0];
  let tableCreated = false;
  let tableOid: number | undefined;
  await smokeQuery("DELETE FROM public.schema_migrations WHERE filename = $1", [spec.filename]);
  await dropIndex(spec);
  try {
    await smokeQuery("CREATE TABLE public.idx_player_rating_history_board_player_time (sentinel INT)");
    tableCreated = true;
    const collision = await inspectConcurrentIndex(database(), spec);
    assert.equal(collision?.relkind, "r", "Same-name table fixture was not created.");
    tableOid = collision.relationOid;
    await runMigration("gostone_migration_table_collision", "failure");
    const preserved = await inspectConcurrentIndex(database(), spec);
    assert.equal(preserved?.relationOid, collision.relationOid, "Same-name table was replaced.");
    assert.equal(await ledgerCount(spec.filename), 0, "Same-name table was adopted.");
  } finally {
    if (tableCreated) {
      const present = await inspectConcurrentIndex(database(), spec);
      assert.equal(present?.relkind, "r", "Test table changed kind before cleanup.");
      if (tableOid !== undefined) {
        assert.equal(present.relationOid, tableOid, "Test table identity changed before cleanup.");
      }
      await smokeQuery("DROP TABLE public.idx_player_rating_history_board_player_time");
    }
    await smokeQuery("DELETE FROM public.schema_migrations WHERE filename = $1", [spec.filename]);
    await runMigration("gostone_migration_restore_012_table");
  }
}

async function verifyConstraintIndexPreserved(): Promise<void> {
  const spec = CONCURRENT_INDEX_SPECS[1];
  let constraintCreated = false;
  await smokeQuery("DELETE FROM public.schema_migrations WHERE filename = $1", [spec.filename]);
  await dropIndex(spec);
  try {
    await smokeQuery(`ALTER TABLE public.matchmaking_queue
                   ADD CONSTRAINT idx_matchmaking_waiting_pool_updated_at UNIQUE (player_key)`);
    constraintCreated = true;
    const collision = await inspectConcurrentIndex(database(), spec);
    assert.ok(collision, "Constraint-index fixture was not created.");
    await runMigration("gostone_migration_constraint_collision", "failure");
    const preserved = await inspectConcurrentIndex(database(), spec);
    assert.equal(preserved?.relationOid, collision.relationOid, "Constraint index was replaced.");
    assert.ok((preserved?.constraintCount ?? 0) > 0, "Constraint dependency was removed.");
    assert.equal(await ledgerCount(spec.filename), 0, "Constraint index was adopted.");
  } finally {
    if (constraintCreated) {
      await smokeQuery(`ALTER TABLE public.matchmaking_queue
                     DROP CONSTRAINT idx_matchmaking_waiting_pool_updated_at`);
    }
    await smokeQuery("DELETE FROM public.schema_migrations WHERE filename = $1", [spec.filename]);
    await runMigration("gostone_migration_restore_015_constraint");
  }
}

async function verifyHostileSearchPath(): Promise<void> {
  const spec = CONCURRENT_INDEX_SPECS[1];
  let schemaCreated = false;
  await assertSmokeDatabaseIdentity(database());
  const existing = await smokeQuery<{ relation: string | null }>(
    "SELECT pg_catalog.to_regnamespace($1)::text AS relation",
    [HOSTILE_SCHEMA],
  );
  assert.equal(existing.rows[0].relation, null, "Hostile search-path fixture already exists.");
  try {
    await smokeQuery(`CREATE SCHEMA gostone_migration_hostile;
      CREATE TABLE gostone_migration_hostile.schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
        sentinel TEXT NOT NULL
      );
      INSERT INTO gostone_migration_hostile.schema_migrations (filename, sentinel)
        VALUES ('015_matchmaking_stale_cleanup_index.sql', 'untouched');
      CREATE TABLE gostone_migration_hostile.matchmaking_queue (
        player_key TEXT PRIMARY KEY,
        board_size INT NOT NULL,
        time_control TEXT NOT NULL,
        rules_profile TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        status TEXT NOT NULL
      );
      INSERT INTO gostone_migration_hostile.matchmaking_queue
        VALUES ('sentinel', 9, 'rapid', 'chinese-2002-gostone-v1', NOW(), 'waiting');`);
    schemaCreated = true;
    await smokeQuery("DELETE FROM public.schema_migrations WHERE filename = $1", [spec.filename]);
    await dropIndex(spec);
    await runMigration(
      "gostone_migration_hostile_path",
      "success",
      "-csearch_path=gostone_migration_hostile,public",
    );
    const decoy = await smokeQuery<{
      ledger_count: number;
      queue_count: number;
      index_name: string | null;
    }>(
      `SELECT (SELECT COUNT(*)::int
                 FROM gostone_migration_hostile.schema_migrations
                WHERE sentinel = 'untouched') AS ledger_count,
              (SELECT COUNT(*)::int
                 FROM gostone_migration_hostile.matchmaking_queue
                WHERE player_key = 'sentinel') AS queue_count,
              pg_catalog.to_regclass(
                'gostone_migration_hostile.idx_matchmaking_waiting_pool_updated_at'
              )::text AS index_name`,
    );
    assert.deepEqual(decoy.rows[0], { ledger_count: 1, queue_count: 1, index_name: null });
    await assertCanonical(spec);
  } finally {
    if (schemaCreated) await smokeQuery("DROP SCHEMA gostone_migration_hostile CASCADE");
    const state = await inspectConcurrentIndex(database(), spec);
    const classification = classifyConcurrentIndex(state, spec, await currentRole());
    if (classification.state !== "exact-valid") {
      if (classification.state === "exact-invalid") await dropIndex(spec);
      else if (classification.state === "conflict") {
        throw new Error("Search-path cleanup found an unsafe index collision.");
      }
      await smokeQuery("DELETE FROM public.schema_migrations WHERE filename = $1", [spec.filename]);
      await runMigration("gostone_migration_restore_015_search_path");
    }
  }
}

async function verifyMigrationLockTimeout(): Promise<void> {
  const beforeLedger = await smokeQuery<{ filename: string; applied_at: Date }>(
    "SELECT filename, applied_at FROM public.schema_migrations ORDER BY filename",
  );
  const beforeIndexes = await Promise.all(CONCURRENT_INDEX_SPECS.map(exactIndex));
  const holder = await getPool().connect();
  let holderLocked = false;
  try {
    await configureSmokeClient(holder);
    const acquired = await holder.query<{ locked: boolean }>(
      "SELECT pg_catalog.pg_try_advisory_lock($1::int, $2::int) AS locked",
      [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_PURPOSE],
    );
    assert.equal(acquired.rows[0].locked, true, "Smoke could not hold the migration lock.");
    holderLocked = true;
    const result = await runMigration("gostone_migration_lock_timeout", "failure");
    assert.ok(
      result.stderr.includes("Another database migration is still running."),
      "Migration lock timeout did not return its bounded diagnostic.",
    );
    const afterLedger = await smokeQuery<{ filename: string; applied_at: Date }>(
      "SELECT filename, applied_at FROM public.schema_migrations ORDER BY filename",
    );
    assert.deepEqual(afterLedger.rows, beforeLedger.rows, "Timed-out migrator changed the ledger.");
    const afterIndexes = await Promise.all(CONCURRENT_INDEX_SPECS.map(exactIndex));
    assert.deepEqual(
      afterIndexes.map(({ relationOid }) => relationOid),
      beforeIndexes.map(({ relationOid }) => relationOid),
      "Timed-out migrator changed an index.",
    );
  } finally {
    let cleanupFailure: unknown;
    let destroyHolder = false;
    if (holderLocked) {
      try {
        const unlocked = await holder.query<{ unlocked: boolean }>(
          "SELECT pg_catalog.pg_advisory_unlock($1::int, $2::int) AS unlocked",
          [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_PURPOSE],
        );
        assert.equal(unlocked.rows[0].unlocked, true, "Smoke could not release the migration lock.");
      } catch (error) {
        destroyHolder = true;
        cleanupFailure = firstFailure(cleanupFailure, error);
      }
    }
    try {
      holder.release(destroyHolder);
    } catch (error) {
      cleanupFailure = firstFailure(cleanupFailure, error);
    }
    if (cleanupFailure) throw cleanupFailure;
  }
}

async function verifyMissingLedgeredIndexRepair(): Promise<void> {
  const spec = CONCURRENT_INDEX_SPECS[1];
  const before = await exactIndex(spec);
  assert.equal(await ledgerCount(spec.filename), 1);
  await dropIndex(spec);
  await runMigration("gostone_migration_repair_missing_015");
  const after = await exactIndex(spec);
  assert.notEqual(after.relationOid, before.relationOid, "Missing ledgered index was not rebuilt.");
  assert.equal(await ledgerCount(spec.filename), 1, "Missing-index repair duplicated its ledger row.");
}

async function verifyInterruptedBuildRecovery(): Promise<void> {
  const spec = CONCURRENT_INDEX_SPECS[1];
  await dropIndex(spec);
  const blocker = await getPool().connect();
  let blockerOpen = false;
  let running: RunningMigration | undefined;
  try {
    await configureSmokeClient(blocker);
    await blocker.query("BEGIN");
    blockerOpen = true;
    await blocker.query(
      `INSERT INTO public.matchmaking_queue (player_key, board_size, status)
       VALUES ($1, 9, 'waiting')`,
      [`migration-blocker-${Date.now()}`],
    );
    running = startMigration("gostone_migration_interrupted_cic");
    let migrationPid: number | undefined;
    await pollUntil(async () => {
      const activity = await smokeQuery<{ pid: number }>(
        `SELECT pid
           FROM pg_catalog.pg_stat_activity
          WHERE application_name = 'gostone_migration_interrupted_cic'
            AND state = 'active'
            AND query ILIKE '%CREATE INDEX CONCURRENTLY%idx_matchmaking_waiting_pool_updated_at%'
          ORDER BY pid`,
      );
      const inspection = await inspectConcurrentIndex(database(), spec);
      if (
        activity.rows.length === 1
        && inspection
        && inspection.live === true
        && inspection.valid === false
        && inspection.activeBuildCount === 1
      ) {
        migrationPid = activity.rows[0].pid;
        return true;
      }
      return false;
    }, "Interrupted-build fixture did not reach a visible invalid concurrent index.");
    assert.ok(migrationPid, "Migration backend could not be identified.");
    const terminated = await smokeQuery<{ terminated: boolean }>(
      "SELECT pg_catalog.pg_terminate_backend($1) AS terminated",
      [migrationPid],
    );
    assert.equal(terminated.rows[0].terminated, true, "Migration backend could not be terminated.");
    await finishMigration(running, "failure");
    running = undefined;
    await blocker.query("ROLLBACK");
    blockerOpen = false;
    const residue = await inspectConcurrentIndex(database(), spec);
    const classification = classifyConcurrentIndex(residue, spec, await currentRole());
    assert.equal(classification.state, "exact-invalid", "Terminated build did not leave safe residue.");
    const residueOid = residue?.relationOid;
    assert.ok(residueOid, "Terminated build residue did not have an OID.");
    await verifyQuarantineRejectsStaleOid(spec, residueOid);
    await verifyTransactionalDropRollback(spec, residueOid);

    await blocker.query("BEGIN");
    blockerOpen = true;
    await blocker.query("SELECT 1 FROM public.matchmaking_queue LIMIT 1");
    running = startMigration("gostone_migration_interrupted_drop");
    let recoveryPid: number | undefined;
    await pollUntil(async () => {
      const activity = await smokeQuery<{ pid: number }>(
        `SELECT pid
           FROM pg_catalog.pg_stat_activity
          WHERE application_name = 'gostone_migration_interrupted_drop'
            AND state = 'active'
            AND wait_event_type = 'Lock'
            AND query ILIKE '%LOCK TABLE public.matchmaking_queue IN ACCESS EXCLUSIVE MODE%'
          ORDER BY pid`,
      );
      if (activity.rows.length === 1) {
        recoveryPid = activity.rows[0].pid;
        return true;
      }
      return false;
    }, "Interrupted-recovery fixture did not reach the transactional table lock.");
    assert.ok(recoveryPid, "Recovery backend could not be identified.");
    const recoveryTerminated = await smokeQuery<{ terminated: boolean }>(
      "SELECT pg_catalog.pg_terminate_backend($1) AS terminated",
      [recoveryPid],
    );
    assert.equal(recoveryTerminated.rows[0].terminated, true, "Recovery backend could not be terminated.");
    await finishMigration(running, "failure");
    running = undefined;
    await blocker.query("ROLLBACK");
    blockerOpen = false;
    const retained = await inspectConcurrentIndex(database(), spec);
    assert.equal(retained?.relationOid, residueOid, "Interrupted recovery did not roll back its drop.");
    assert.equal(
      classifyConcurrentIndex(retained, spec, await currentRole()).state,
      "exact-invalid",
      "Interrupted recovery did not preserve recoverable invalid state.",
    );

    await runMigration("gostone_migration_recover_interrupted_cic");
    const recovered = await exactIndex(spec);
    assert.notEqual(recovered.relationOid, residueOid, "Invalid concurrent index was not rebuilt.");
    assert.equal(await ledgerCount(spec.filename), 1);
  } finally {
    let cleanupFailure: unknown;
    let destroyBlocker = false;
    if (running) {
      try {
        if (running.child.exitCode === null && running.child.signalCode === null) {
          running.child.kill("SIGKILL");
        }
        await running.completion;
      } catch (error) {
        cleanupFailure = firstFailure(cleanupFailure, error);
      }
    }
    if (blockerOpen) {
      try {
        await blocker.query("ROLLBACK");
      } catch (error) {
        destroyBlocker = true;
        cleanupFailure = firstFailure(cleanupFailure, error);
      }
    }
    try {
      blocker.release(destroyBlocker);
    } catch (error) {
      cleanupFailure = firstFailure(cleanupFailure, error);
    }
    try {
      const state = await inspectConcurrentIndex(database(), spec);
      const classification = classifyConcurrentIndex(state, spec, await currentRole());
      if (classification.state !== "exact-valid") {
        if (state && classification.state === "exact-invalid") await dropIndex(spec);
        else if (state) throw new Error("Interrupted-build cleanup found an unsafe index collision.");
        await runMigration("gostone_migration_restore_015_interruption");
      }
    } catch (error) {
      cleanupFailure = firstFailure(cleanupFailure, error);
    }
    if (cleanupFailure) throw cleanupFailure;
  }
}

async function restoreCanonicalState(): Promise<void> {
  for (const spec of CONCURRENT_INDEX_SPECS) {
    const state = await inspectConcurrentIndex(database(), spec);
    const classification = classifyConcurrentIndex(state, spec, await currentRole());
    if (classification.state === "conflict") {
      throw new Error(`Canonical cleanup found an unsafe ${spec.filename} collision.`);
    }
    if (classification.state !== "exact-valid" || await ledgerCount(spec.filename) !== 1) {
      await runMigration(`gostone_migration_final_restore_${spec.filename.slice(0, 3)}`);
    }
    await assertCanonical(spec);
  }
}

async function run(): Promise<void> {
  if (!isUnambiguousLocalDatabase(getDatabaseUrl())) {
    throw new Error("Migration recovery smoke requires an unambiguous local database.");
  }
  const client = await getPool().connect();
  smokeClient = client;
  await configureSmokeClient(client);
  assert.equal((await currentRole()), getSmokeDatabaseExpectation().roleName);
  for (const spec of CONCURRENT_INDEX_SPECS) await assertCanonical(spec);

  try {
    await verifySerializedAdoption();
    await verifyMigrationLockTimeout();
    await verifySecondOrphanAdoption();
    await verifyWrongDefinitionPreserved();
    await verifySameNameTablePreserved();
    await verifyConstraintIndexPreserved();
    await verifyHostileSearchPath();
    await verifyMissingLedgeredIndexRepair();
    await verifyInterruptedBuildRecovery();
  } finally {
    await restoreCanonicalState();
  }

  for (const spec of CONCURRENT_INDEX_SPECS) await assertCanonical(spec);
  console.log("Verified serialized migrations and fail-closed concurrent-index recovery.");
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Migration recovery smoke failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    smokeClient?.release();
    smokeClient = undefined;
    await closePool();
  });
