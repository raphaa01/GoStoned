import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8").replaceAll("\r\n", "\n");
const migration = readFileSync(
  join(process.cwd(), "db/migrations/010_move_board_hash_guard.sql"),
  "utf8",
).replaceAll("\r\n", "\n");
const productionPreflight = readFileSync(
  join(process.cwd(), "scripts/check-mvp.ts"),
  "utf8",
);

const constraintName = "moves_board_hash_required_check";
const checkExpression = "CHECK (board_hash IS NOT NULL)";

function movesTableDefinition(sql: string): string {
  const start = sql.indexOf("CREATE TABLE IF NOT EXISTS moves (");
  assert.notEqual(start, -1, "moves must be created");
  const end = sql.indexOf("\n);", start);
  assert.notEqual(end, -1, "moves definition must terminate");
  return sql.slice(start, end + 3);
}

function upgradeGuard(sql: string): string {
  const constraint = sql.indexOf(`conname = '${constraintName}'`);
  assert.notEqual(constraint, -1, "the catalog guard must name the constraint");
  const start = sql.lastIndexOf("DO $$", constraint);
  const end = sql.indexOf("\n$$;", constraint);
  assert.ok(start >= 0 && end > constraint, "the catalog guard must be one DO block");
  return sql.slice(start, end + 4);
}

test("fresh databases require move hashes at both column and named-constraint boundaries", () => {
  const moves = movesTableDefinition(schema);
  assert.ok(moves.includes("board_hash TEXT NOT NULL"));
  assert.ok(moves.includes(`CONSTRAINT ${constraintName} ${checkExpression}`));
});

test("the upgrade guard preserves legacy NULL rows but rejects subsequent NULL writes", () => {
  for (const sql of [schema, migration]) {
    assert.ok(sql.includes(`conname = '${constraintName}'`));
    assert.ok(sql.includes("conrelid = 'public.moves'::regclass"));
    assert.ok(sql.includes(`ALTER TABLE public.moves\n      ADD CONSTRAINT ${constraintName}`));
    assert.ok(sql.includes(`${checkExpression} NOT VALID`));
    assert.equal(sql.includes(`VALIDATE CONSTRAINT ${constraintName}`), false);
    assert.equal(/UPDATE\s+moves\b/i.test(sql), false);
    assert.equal(/DELETE\s+FROM\s+moves\b/i.test(sql), false);
    assert.equal(/ALTER\s+COLUMN\s+board_hash\s+SET\s+NOT\s+NULL/i.test(sql), false);
  }
  assert.ok(migration.includes("SET LOCAL lock_timeout = '5s'"));
  assert.ok(migration.includes("SET LOCAL statement_timeout = '60s'"));
  assert.equal(upgradeGuard(schema), upgradeGuard(migration));
});

test("production preflight requires the exact hash guard without requiring legacy validation", () => {
  assert.ok(productionPreflight.includes(`${constraintName}:moves:c`));
  assert.ok(productionPreflight.includes("rollout_constraint_signatures"));
  assert.ok(productionPreflight.includes("CHECK ((board_hash IS NOT NULL))"));
  const rolloutEnd = productionPreflight.indexOf("AS rollout_constraint_signatures");
  const rolloutStart = productionPreflight.lastIndexOf("ARRAY(", rolloutEnd);
  assert.ok(rolloutStart >= 0 && rolloutEnd > rolloutStart);
  const rolloutQuery = productionPreflight.slice(rolloutStart, rolloutEnd);
  assert.equal(rolloutQuery.includes("convalidated"), false);
  const definitionsEnd = productionPreflight.indexOf("AS constraint_definitions");
  const definitionsStart = productionPreflight.lastIndexOf("JSONB_OBJECT_AGG(", definitionsEnd);
  assert.ok(definitionsStart >= 0 && definitionsEnd > definitionsStart);
  const definitionsQuery = productionPreflight.slice(definitionsStart, definitionsEnd);
  assert.ok(definitionsQuery.includes("constraint_row.conname <> 'moves_board_hash_required_check'"));
  assert.ok(definitionsQuery.includes("constraint_row.conrelid = 'public.moves'::regclass"));
});
