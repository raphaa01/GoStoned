import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { IMPORTED_PUZZLES } from "./importedCatalog";
import { attemptImportedPuzzle } from "./importedService";
import type { PuzzlePly } from "./types";

test("all 183 supplied solution and wrong paths finish correctly, including player passes and late mistakes", async () => {
  let progress: PuzzlePly[] = [];
  let revision = 0;
  let solved = false;
  let attempts = 0;
  let first: boolean | null = null;
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("SELECT puzzle_id")) return { rows: attempts ? [{ variation_progress: progress, variation_revision: revision, solved, attempt_count: attempts, first_attempt_correct: first }] : [] };
      if (sql.includes("INSERT INTO puzzle_attempts")) {
        progress = JSON.parse(values[6] as string);
        solved = values[2] as boolean;
        first ??= values[3] as boolean | null;
        revision++; attempts++;
        return { rows: [{ variation_revision: revision, attempt_count: attempts, first_attempt_correct: first, solved }] };
      }
      return { rows: [] };
    }, release() {},
  } as unknown as PoolClient;
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = { connect: async () => client } as unknown as Pool;
  try {
    for (const puzzle of IMPORTED_PUZZLES) for (const [index, path] of puzzle.paths.slice(0, 3).entries()) {
      progress = []; revision = 0; solved = false; attempts = 0; first = null;
      for (const ply of path.line.filter((ply) => ply.color === puzzle.toPlay)) {
        const result = await attemptImportedPuzzle(puzzle.id, "user:branch-check", { ...ply, revision, action: ply.move === "pass" ? "pass" : "play" }, true);
        const terminal = path.line.at(-1) === ply || path.line.at(-2) === ply;
        assert.equal(result.outcome, terminal ? index === 0 ? "solved" : "retry" : "continue", `${puzzle.id} branch ${index}, ${ply.move}`);
      }
      assert.equal(solved, index === 0);
      assert.equal(first, index === 0);
      if (index !== 0) assert.ok(puzzle.paths.some((candidate) => candidate.solved && progress.every((ply, i) => candidate.line[i]?.move === ply.move)), "failure retains a correct prefix");
    }
  } finally { globalThis.goStonedDbPool = previous; }
});
