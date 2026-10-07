import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { attemptPuzzle } from "./puzzleService";
import type { PuzzlePly } from "./types";

test("a failed continuation keeps the last correct position and accepts the next correct move", async () => {
  const line: PuzzlePly[] = [
    { color: "black", x: 0, y: 0, move: "A9" },
    { color: "white", x: 1, y: 0, move: "B9" },
    { color: "black", x: 2, y: 0, move: "C9" },
  ];
  let progress = line.slice(0, 2);
  let revision = 2;
  let attempts = 1;
  let solved = false;
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("FROM puzzles puzzle")) return { rows: [{
        id: "puzzle", kind: "practice", category: "tesuji", board_size: 9,
        board: Array.from({ length: 9 }, () => Array(9).fill(null)), to_play: "black",
        variation: { version: 1, mainLine: line, refutations: [], fallbackExplanation: { en: "Try again", de: "Noch einmal" } },
        explanation: { en: "Correct", de: "Richtig" }, solution_x: 0, solution_y: 0, solution_move: "A9",
        variation_progress: progress, variation_revision: revision, attempt_count: attempts,
        solved, first_attempt_correct: false,
      }] };
      if (sql.includes("INSERT INTO puzzle_attempts")) {
        progress = JSON.parse(values[6] as string) as PuzzlePly[];
        solved = values[4] as boolean;
        attempts++;
        revision++;
        return { rows: [{ attempt_count: attempts, solved, first_attempt_correct: false, variation_revision: revision }] };
      }
      return { rows: [] };
    },
    release() {},
  } as unknown as PoolClient;
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = { connect: async () => client } as unknown as Pool;
  try {
    const failed = await attemptPuzzle("puzzle", "user:test", { x: 4, y: 4, revision }, true);
    assert.equal(failed.outcome, "retry");
    assert.deepEqual(failed.variationProgress, line.slice(0, 2));
    assert.deepEqual(progress, line.slice(0, 2), "the database must retain correct progress, not reset it");
    const finished = await attemptPuzzle("puzzle", "user:test", { x: 2, y: 0, revision: failed.variationRevision }, true);
    assert.equal(finished.outcome, "solved");
    assert.deepEqual(finished.variationProgress, line);
    assert.equal(finished.firstAttemptCorrect, false);
  } finally {
    globalThis.goStonedDbPool = previous;
  }
});
