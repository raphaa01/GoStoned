import assert from "node:assert/strict";
import test from "node:test";
import { applyMove } from "@/lib/game/goEngine";
import {
  DAILY_PUZZLE_CYCLE_LENGTH,
  DAILY_PUZZLE_CYCLE_START,
  dailyPuzzleAt,
  dailyPuzzleCycleOrder,
} from "./dailyCatalog";

test("daily catalog contains all 40 distinct, legal curated problems", () => {
  assert.equal(DAILY_PUZZLE_CYCLE_LENGTH, 40);
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
    assert.ok(puzzle.candidateMoves.length > 0, "every daily problem needs an accepted answer");
    for (const move of puzzle.candidateMoves) {
      assert.equal(applyMove(puzzle.board, "black", move.x, move.y).ok, true);
      assert.ok(puzzle.localRegion.some((point) => point.x === move.x && point.y === move.y));
    }
  }
  assert.equal(boards.size, DAILY_PUZZLE_CYCLE_LENGTH);
  assert.equal(sources.size, DAILY_PUZZLE_CYCLE_LENGTH);
});

test("daily catalog advances once per UTC date and wraps after day 40", () => {
  assert.equal(dailyPuzzleCycleOrder(DAILY_PUZZLE_CYCLE_START), 1);
  assert.equal(dailyPuzzleCycleOrder("2026-09-09"), 2);
  assert.equal(dailyPuzzleCycleOrder("2026-09-27"), 20);
  assert.equal(dailyPuzzleCycleOrder("2026-09-28"), 21);
  assert.equal(dailyPuzzleCycleOrder("2026-10-17"), 40);
  assert.equal(dailyPuzzleCycleOrder("2026-10-18"), 1);
  assert.equal(dailyPuzzleCycleOrder("2026-09-07"), 40);
});
