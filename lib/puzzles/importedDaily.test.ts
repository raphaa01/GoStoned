import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { IMPORTED_PUZZLES, dailyImportedPuzzle } from "./importedCatalog";
import { attemptImportedPuzzle, readImportedPuzzleHint, readImportedPuzzleHub } from "./importedService";
import type { PuzzlePly } from "./types";

test("daily loads, persists independently of practice, and is playable again after the complete cycle", async () => {
  let today = "2026-10-08";
  const catalog = new Map<string, {model_name: string}>();
  const attempts = new Map<string, { variation_progress: PuzzlePly[]; variation_revision: number; solved: boolean; first_attempt_correct: boolean | null; attempt_count: number }>();
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.startsWith("SELECT (CURRENT_TIMESTAMP")) return {rows: [{today}]};
      if (sql.startsWith("INSERT INTO puzzles")) {
        for (const row of JSON.parse(values[0] as string)) if (!catalog.has(row.id)) catalog.set(row.id, row);
      }
      if (sql.includes("FROM puzzles puzzle LEFT JOIN")) return {rows: (values[1] as string[]).map((id) => ({id, rating: 500, ...attempts.get(id)}))};
      if (sql.startsWith("SELECT model_name")) return {rows: catalog.has(values[0] as string) ? [catalog.get(values[0] as string)] : []};
      if (sql.startsWith("SELECT puzzle_id") || sql.startsWith("SELECT variation_progress")) return {rows: attempts.has(values[0] as string) ? [attempts.get(values[0] as string)] : []};
      if (sql.startsWith("INSERT INTO puzzle_attempts")) {
        const id = values[0] as string;
        const current = attempts.get(id);
        const state = {variation_progress: JSON.parse(values[6] as string), variation_revision: (current?.variation_revision ?? 0) + 1, solved: values[2] as boolean, first_attempt_correct: current?.first_attempt_correct ?? values[3] as boolean | null, attempt_count: (current?.attempt_count ?? 0) + 1};
        attempts.set(id, state);
        return {rows: [state]};
      }
      return {rows: []};
    }, release() {},
  } as unknown as PoolClient;
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = {query: client.query.bind(client), connect: async () => client} as unknown as Pool;
  const player = "guest:daily-test";
  const source = dailyImportedPuzzle(today);
  async function solve(id: string, accountAccess: boolean) {
    let revision = 0;
    for (const ply of source.paths[0].line.filter((ply) => ply.color === source.toPlay)) {
      const attempt = await attemptImportedPuzzle(id, player, {...ply, revision, action: ply.move === "pass" ? "pass" : "play"}, accountAccess);
      assert.equal(attempt.puzzleId, id);
      revision = attempt.variationRevision;
    }
  }
  try {
    const practice = await readImportedPuzzleHub(player, "practice");
    assert.equal(practice.puzzles.length, 61);
    await solve(source.id, true);
    const daily = (await readImportedPuzzleHub(player, "daily")).puzzles[0];
    assert.notEqual(daily.id, source.id);
    assert.equal(daily.dailyDate, today);
    assert.equal(daily.solved, false, "practice never spoils the daily answer");
    assert.equal(daily.solution, null);
    assert.deepEqual(daily.board, source.board);
    await readImportedPuzzleHint(daily.id, player, false);
    await solve(daily.id, false);
    assert.equal((await readImportedPuzzleHub(player, "daily")).puzzles[0].solved, true);
    today = new Date(Date.UTC(2026, 9, 8 + 61)).toISOString().slice(0, 10);
    const recurrence = (await readImportedPuzzleHub(player, "daily")).puzzles[0];
    assert.deepEqual(recurrence.board, daily.board);
    assert.notEqual(recurrence.id, daily.id);
    assert.equal(recurrence.solved, false);
    assert.equal(recurrence.variationRevision, 0);
    assert.equal(recurrence.solution, null);
    await assert.rejects(readImportedPuzzleHint(daily.id, player, false), /log in/i);
    await assert.rejects(readImportedPuzzleHint(source.id, player, false), /log in/i);
    await solve(recurrence.id, false);
    const reloaded = await readImportedPuzzleHub(player, "practice");
    assert.equal(reloaded.puzzles.find((puzzle) => puzzle.id === source.id)?.solved, true, "practice history survives the next daily cycle");
    assert.equal(reloaded.puzzles.filter((puzzle) => puzzle.solved).length, 1);
    assert.deepEqual(new Set(reloaded.puzzles.map((puzzle) => puzzle.id)), new Set(IMPORTED_PUZZLES.map((puzzle) => puzzle.id)), "daily instances never appear in More puzzles");
  } finally {globalThis.goStonedDbPool = previous;}
});
