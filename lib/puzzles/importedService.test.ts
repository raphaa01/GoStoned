import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { attemptImportedPuzzle, readImportedPuzzleHint } from "./importedService";
import { IMPORTED_PUZZLES } from "./importedCatalog";
import type { PuzzlePly } from "./types";

test("wrong branches remain interactive until their endpoint, survive reload, undo, and preserve first-try history", async () => {
  const puzzle = IMPORTED_PUZZLES.find((candidate) => candidate.paths[1].line.length === 6)!;
  const wrong = puzzle.paths[1].line;
  let progress: PuzzlePly[] = [];
  let revision = 0;
  let attempts = 0;
  let solved = false;
  let firstAttemptCorrect: boolean | null = null;
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("SELECT puzzle_id") || sql.startsWith("SELECT variation_progress")) return {rows: attempts ? [{id:puzzle.id, variation_progress:progress, variation_revision:revision, attempt_count:attempts, solved, first_attempt_correct:firstAttemptCorrect}] : []};
      if (sql.includes("INSERT INTO puzzle_attempts")) {
        progress = JSON.parse(values[6] as string);
        solved = values[2] as boolean;
        firstAttemptCorrect ??= values[3] as boolean | null;
        attempts++; revision++;
        return {rows:[{attempt_count:attempts, variation_revision:revision, first_attempt_correct:firstAttemptCorrect, solved}]};
      }
      return {rows:[]};
    }, release() {},
  } as unknown as PoolClient;
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = {connect:async()=>client, query:client.query.bind(client)} as unknown as Pool;
  const play = (ply: PuzzlePly) => attemptImportedPuzzle(puzzle.id, "user:test-import", {...ply, revision}, true);
  try {
    const unknown = await attemptImportedPuzzle(puzzle.id, "user:test-import", {x:18,y:18,revision}, true);
    assert.equal(unknown.outcome, "unknown");
    assert.equal(attempts, 0, "unverified choices do not advance or penalize attempts");
    assert.equal((await play(wrong[0])).outcome, "continue");
    assert.deepEqual(progress, wrong.slice(0,2));
    assert.equal(firstAttemptCorrect, null, "no early failure label or first-try penalty");
    const continued = await play(wrong[2]);
    assert.equal(continued.outcome, "continue");
    const undone = await attemptImportedPuzzle(puzzle.id, "user:test-import", {x:-1,y:-1,revision}, true);
    assert.deepEqual(undone.variationProgress, wrong.slice(0,2));
    await play(wrong[2]);
    const failure = await play(wrong[4]);
    assert.equal(failure.outcome, "retry");
    assert.deepEqual(failure.displayLine, wrong);
    assert.deepEqual(progress, []);
    assert.equal(firstAttemptCorrect, false);
    const hint = await readImportedPuzzleHint(puzzle.id, "user:test-import", true);
    assert.deepEqual(hint, {x:puzzle.paths[0].line[0].x,y:puzzle.paths[0].line[0].y});
    for (const ply of puzzle.paths[0].line.filter((ply)=>ply.color===puzzle.toPlay)) await play(ply);
    assert.equal(solved, true);
    assert.equal(firstAttemptCorrect, false);
    await assert.rejects(attemptImportedPuzzle(puzzle.id, "user:test-import", {x:0,y:0,revision:0}, true), /puzzle changed/i);
  } finally { globalThis.goStonedDbPool=previous; }
});
