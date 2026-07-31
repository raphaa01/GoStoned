import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, countLiberties, getGroup } from "@/lib/game/goEngine";
import { PUZZLE_CATEGORIES, PUZZLES_PER_CATEGORY } from "./types";
import { curatedPuzzle, curatedPuzzleCount } from "./curatedCatalog";

test("curated catalog contains 40 genuinely different legal positions", () => {
  assert.equal(curatedPuzzleCount(), 40);
  const hashes = new Set<string>();
  const sourceIds = new Set<string>();
  for (const category of PUZZLE_CATEGORIES) {
    for (let order = 1; order <= PUZZLES_PER_CATEGORY; order += 1) {
      const puzzle = curatedPuzzle(category, order);
      const hash = JSON.stringify(puzzle.board);
      assert.equal(hashes.has(hash), false, `${category} ${order} repeats another position`);
      assert.equal(sourceIds.has(puzzle.sourceId), false, `${category} ${order} repeats a source`);
      hashes.add(hash);
      sourceIds.add(puzzle.sourceId);
      assert.ok(puzzle.candidateMoves.length > 0);
      for (const candidate of puzzle.candidateMoves) {
        assert.equal(puzzle.board[candidate.y][candidate.x], null);
        assert.equal(applyMove(puzzle.board, "black", candidate.x, candidate.y).ok, true);
      }
      const visited = new Set<string>();
      for (let y = 0; y < 13; y += 1) {
        for (let x = 0; x < 13; x += 1) {
          if (!puzzle.board[y][x] || visited.has(`${x}:${y}`)) continue;
          const group = getGroup(puzzle.board, { x, y });
          for (const point of group) visited.add(`${point.x}:${point.y}`);
          assert.ok(countLiberties(puzzle.board, group) > 0, `${category} ${order} has a dead source group`);
        }
      }
    }
  }
  assert.equal(hashes.size, 40);
  assert.equal(sourceIds.size, 40);
});
