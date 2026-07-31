import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../db/migrations/019_katago_puzzles.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("../../workers/katago/puzzles.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("./puzzleService.ts", import.meta.url), "utf8");

test("KataGo puzzles are persistent, private, queued, and answer-safe", () => {
  for (const source of [schema, migration]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS puzzles/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS puzzle_generation_jobs/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS puzzle_attempts/);
    assert.match(source, /ALTER TABLE puzzles ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /REVOKE ALL ON puzzles, puzzle_generation_jobs, puzzle_attempts FROM PUBLIC/);
    assert.match(source, /WHERE kind = 'daily'/);
  }
  assert.match(worker, /engine\.analyzeCurrent/);
  assert.match(worker, /KATAGO_PUZZLE_MAX_VISITS/);
  assert.match(worker, /FOR UPDATE SKIP LOCKED/);
  assert.match(service, /solution: solved \? solution\(row\) : null/);
  assert.ok(
    schema.replaceAll("\r\n", "\n").endsWith(migration.replaceAll("\r\n", "\n")),
    "Canonical schema must end with migration 019.",
  );
});
