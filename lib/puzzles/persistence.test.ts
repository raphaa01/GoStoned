import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../db/migrations/019_katago_puzzles.sql", import.meta.url), "utf8");
const variationMigration = readFileSync(new URL("../../db/migrations/020_puzzle_variation_training.sql", import.meta.url), "utf8");
const boardGuardMigration = readFileSync(new URL("../../db/migrations/022_curated_puzzle_board_guard.sql", import.meta.url), "utf8");
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
  assert.match(worker, /PUZZLES_PER_CATEGORY/);
  assert.match(worker, /mainLine/);
  assert.match(service, /variationProgress/);
  assert.match(service, /solution: solved \? solution\(row, variation\) : null/);
  assert.match(variationMigration, /puzzles_category_shape_check/);
  assert.match(variationMigration, /idx_puzzles_category_order/);
  assert.match(variationMigration, /variation_progress JSONB NOT NULL/);
  assert.ok(
    schema.replaceAll("\r\n", "\n").endsWith(boardGuardMigration.replaceAll("\r\n", "\n")),
    "Canonical schema must end with migration 022.",
  );
});
