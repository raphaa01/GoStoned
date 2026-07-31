import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMigrationSessionEndpoint,
  classifyConcurrentIndex,
  CONCURRENT_INDEX_SPECS,
  releaseMigrationSession,
  type ConcurrentIndexInspection,
  validateMigrationIndexContract,
} from "../scripts/migrationIndexes";

test("migration runner rejects known transaction-pooler connection targets", () => {
  assert.throws(
    () => assertMigrationSessionEndpoint("postgresql://user:secret@db.example.com:6543/gostone"),
    /direct or session-mode/,
  );
  assert.throws(
    () => assertMigrationSessionEndpoint("postgresql://user:secret@db.example.com/gostone?pgbouncer=true"),
    /direct or session-mode/,
  );
  assert.throws(
    () => assertMigrationSessionEndpoint("postgresql://user:secret@db.example.com/gostone?pool_mode=transaction"),
    /direct or session-mode/,
  );
  assert.throws(
    () => assertMigrationSessionEndpoint(
      "postgresql://user:secret@db.example.com:5432/gostone?host=region.pooler.supabase.com&port=6543",
    ),
    /unambiguous direct or session-mode/,
  );
  assert.doesNotThrow(
    () => assertMigrationSessionEndpoint("postgresql://user:secret@db.example.com:5432/gostone"),
  );
});

test("migration files fail closed on unknown nontransactional contracts", () => {
  assert.throws(
    () => validateMigrationIndexContract(
      "999_unknown.sql",
      "-- gostone:migration-mode=nontransactional\nSELECT 1;",
    ),
    /Unsupported nontransactional migration contract/,
  );
  assert.throws(
    () => validateMigrationIndexContract(CONCURRENT_INDEX_SPECS[0].filename, "SELECT 1;"),
    /Unsupported nontransactional migration contract/,
  );
  assert.equal(validateMigrationIndexContract("001_initial.sql", "SELECT 1;"), undefined);
});

test("migration unlock failure destroys the session instead of pooling it", async () => {
  const releases: Array<boolean | undefined> = [];
  const client = {
    async query() {
      return { rows: [{ unlocked: false }] };
    },
    release(destroy?: boolean) {
      releases.push(destroy);
    },
  } as unknown as Parameters<typeof releaseMigrationSession>[0];
  await assert.rejects(releaseMigrationSession(client, true), /lock release failed/);
  assert.deepEqual(releases, [true]);
});

const spec = CONCURRENT_INDEX_SPECS[0];
const exact: ConcurrentIndexInspection = {
  relationOid: 42,
  relkind: "i",
  relationPersistence: "p",
  tablespaceOid: 0,
  relationOptions: null,
  ownerName: "gostone_ci_runner",
  tableSchema: spec.schema,
  tableName: spec.table,
  tableOid: 41,
  tableKind: "r",
  tableOwnerName: "gostone_ci_runner",
  method: spec.method,
  keyExpressions: [...spec.keyExpressions],
  includeExpressions: [...spec.includeExpressions],
  predicate: spec.predicate,
  unique: false,
  primary: false,
  exclusion: false,
  replicaIdentity: false,
  clustered: false,
  ready: true,
  valid: true,
  live: true,
  constraintCount: 0,
  activeBuildCount: 0,
};

test("concurrent index classifier distinguishes missing, usable, and recoverable states", () => {
  assert.equal(classifyConcurrentIndex(null, spec, exact.ownerName).state, "missing");
  assert.equal(classifyConcurrentIndex(exact, spec, exact.ownerName).state, "exact-valid");
  for (const state of [
    { ready: false },
    { valid: false },
  ]) {
    const invalid = { ...exact, valid: false, ...state };
    assert.equal(
      classifyConcurrentIndex(invalid, spec, exact.ownerName).state,
      "exact-invalid",
    );
  }
});

test("concurrent index classifier fails closed on every structural conflict", () => {
  const conflicts: ConcurrentIndexInspection[] = [
    { ...exact, relkind: "r" },
    { ...exact, relationPersistence: "u" },
    { ...exact, tablespaceOid: 42 },
    { ...exact, relationOptions: ["fillfactor=70"] },
    { ...exact, ownerName: "another_owner" },
    { ...exact, tableSchema: "hostile" },
    { ...exact, tableName: "another_table" },
    { ...exact, tableOid: null },
    { ...exact, tableKind: "p" },
    { ...exact, tableOwnerName: "another_owner" },
    { ...exact, method: "hash" },
    { ...exact, keyExpressions: [...spec.keyExpressions].reverse() },
    { ...exact, includeExpressions: [] },
    { ...exact, predicate: "false" },
    { ...exact, unique: true },
    { ...exact, primary: true },
    { ...exact, exclusion: true },
    { ...exact, replicaIdentity: true },
    { ...exact, clustered: true },
    { ...exact, constraintCount: 1 },
    { ...exact, activeBuildCount: 1 },
    { ...exact, live: false },
    { ...exact, ready: false },
  ];
  for (const inspection of conflicts) {
    assert.equal(
      classifyConcurrentIndex(inspection, spec, exact.ownerName).state,
      "conflict",
    );
  }
});
