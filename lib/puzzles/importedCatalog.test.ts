import assert from "node:assert/strict";
import test from "node:test";
import { IMPORTED_PUZZLES, PUZZLE_EXPORT_SUMMARY, dailyImportedPuzzle, dailyImportedPuzzleId, matchingPuzzlePaths, replayPuzzleLine } from "./importedCatalog";
import { nextUnsolvedPuzzle, orderPuzzleQueue } from "./queue";
import type { PuzzleView } from "./types";

test("the supplied export contains 61 unique verified puzzles and records the four missing ones", () => {
  assert.equal(IMPORTED_PUZZLES.length, 61);
  assert.equal(new Set(IMPORTED_PUZZLES.map((puzzle) => puzzle.id)).size, 61);
  assert.equal(PUZZLE_EXPORT_SUMMARY.requested, 65);
  assert.equal(PUZZLE_EXPORT_SUMMARY.skipped.length, 4);
  for (const puzzle of IMPORTED_PUZZLES) {
    assert.ok(puzzle.rankKyu >= 1 && puzzle.rankKyu <= 30);
    assert.equal(puzzle.paths[0].solved, true);
    assert.equal(puzzle.paths[1].solved, false);
    assert.equal(puzzle.paths[2].solved, false);
    for (const path of puzzle.paths) {
      const final = replayPuzzleLine(puzzle.board, path.line);
      assert.equal(final.length, 19);
      assert.deepEqual(matchingPuzzlePaths(puzzle, path.line.slice(0, 2)).includes(path), true);
      for (const ply of path.line) if (ply.move !== "pass") assert.ok(ply.x < puzzle.viewportSize && ply.y < puzzle.viewportSize, `${puzzle.id}: every move stays visible`);
      if (path.solved && puzzle.goalType === "capture") assert.ok(puzzle.target.every(({x,y}) => final[y][x] !== puzzle.targetColor), "a solved capture actually removes its target");
    }
  }
});

test("daily rotation covers the entire imported catalog deterministically", () => {
  const dates = Array.from({length: 122}, (_, day) => new Date(Date.UTC(2026, 9, 8 + day)).toISOString().slice(0, 10));
  const selected = dates.map((date) => dailyImportedPuzzle(date).id);
  assert.deepEqual(selected.slice(0, 61), IMPORTED_PUZZLES.map((puzzle) => puzzle.id));
  assert.equal(new Set(selected).size, 61);
  assert.deepEqual(selected.slice(61), selected.slice(0, 61));
  assert.equal(dailyImportedPuzzle(dates[0]).id, selected[0]);
  assert.equal(new Set(dates.map(dailyImportedPuzzleId)).size, 122, "each recurrence can be solved again");
  assert.equal(dailyImportedPuzzleId(dates[0]), dailyImportedPuzzleId(dates[0]));
  assert.equal(dailyImportedPuzzle("2026-10-07").id, selected[60], "dates before launch wrap correctly too");
});

test("kyu matches come first, solved puzzles are skipped, and all other ranks remain available", () => {
  const puzzles = [25, 30, 20, 30, 1].map((rankKyu, i) => ({ id: String(i), rankKyu, collectionOrder: i, solved: false } as PuzzleView));
  const queue = orderPuzzleQueue(puzzles, 30);
  assert.deepEqual(queue.map((puzzle) => puzzle.rankKyu), [30,30,25,20,1]);
  queue[0].solved = true;
  assert.equal(nextUnsolvedPuzzle(queue)?.id, queue[1].id);
  queue[1].solved = true;
  assert.equal(nextUnsolvedPuzzle(queue)?.rankKyu, 25);
  assert.equal(orderPuzzleQueue(puzzles, 1)[0].rankKyu, 1);
});
