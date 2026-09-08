import assert from "node:assert/strict";
import test from "node:test";
import { applyMove } from "@/lib/game/goEngine";
import {
  DAILY_PUZZLE_CYCLE_LENGTH,
  DAILY_PUZZLE_CYCLE_START,
  dailyPuzzleAt,
  dailyPuzzleCycleOrder,
} from "./dailyCatalog";

test("daily catalog contains 20 distinct, legal local problems", () => {
  assert.equal(DAILY_PUZZLE_CYCLE_LENGTH, 20);
  const boards = new Set<string>();
  const sources = new Set<string>();
  for (let order = 1; order <= DAILY_PUZZLE_CYCLE_LENGTH; order += 1) {
    const puzzle = dailyPuzzleAt(order);
    assert.equal(puzzle.cycleOrder, order);
    assert.equal(boards.has(JSON.stringify(puzzle.board)), false);
    assert.equal(sources.has(puzzle.sourceId), false);
    boards.add(JSON.stringify(puzzle.board));
    sources.add(puzzle.sourceId);
    assert.ok(puzzle.localRegion.length > 0);
    assert.equal(puzzle.candidateMoves.length, 1, "daily answers must be unambiguous");
    assert.ok(puzzle.localRegion.length <= 49, "daily problems must stay inside a 7x7 focus");
    for (const move of puzzle.candidateMoves) {
      assert.equal(applyMove(puzzle.board, "black", move.x, move.y).ok, true);
      assert.ok(puzzle.localRegion.some((point) => point.x === move.x && point.y === move.y));
      assert.ok(puzzle.localRegion.every((point) => (
        Math.abs(point.x - move.x) <= 3 && Math.abs(point.y - move.y) <= 3
      )));
    }
  }
  assert.equal(boards.size, DAILY_PUZZLE_CYCLE_LENGTH);
  assert.equal(sources.size, DAILY_PUZZLE_CYCLE_LENGTH);
});

test("daily catalog advances once per UTC date and wraps after day 20", () => {
  assert.equal(dailyPuzzleCycleOrder(DAILY_PUZZLE_CYCLE_START), 1);
  assert.equal(dailyPuzzleCycleOrder("2026-09-09"), 2);
  assert.equal(dailyPuzzleCycleOrder("2026-09-27"), 20);
  assert.equal(dailyPuzzleCycleOrder("2026-09-28"), 1);
  assert.equal(dailyPuzzleCycleOrder("2026-09-07"), 20);
});
