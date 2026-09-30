import assert from "node:assert/strict";
import test from "node:test";
import { applyMove } from "@/lib/game/goEngine";
import {
  GOKYO_SHUMYO_CATEGORY_COUNTS,
  GOKYO_SHUMYO_SOURCE,
  gokyoShumyoPuzzles,
} from "./gokyoShumyo";
import { localPuzzleViewportSize } from "./puzzleViewport";

test("the static Gokyo Shumyo catalog contains 200 ordered historical positions", () => {
  const puzzles = gokyoShumyoPuzzles();
  assert.equal(puzzles.length, 200);
  assert.deepEqual(
    Object.fromEntries(Object.keys(GOKYO_SHUMYO_CATEGORY_COUNTS).map((category) => [
      category,
      puzzles.filter((puzzle) => puzzle.category === category).length,
    ])),
    GOKYO_SHUMYO_CATEGORY_COUNTS,
  );
  assert.equal(GOKYO_SHUMYO_SOURCE.publicationYear, 1812);
  assert.equal(GOKYO_SHUMYO_SOURCE.nijlDoi, "10.20730/100344678");
  assert.equal(new Set(puzzles.map((puzzle) => puzzle.sourceId)).size, puzzles.length);
  assert.ok(puzzles.some((puzzle) => puzzle.difficulty === "beginner"));
  assert.ok(puzzles.some((puzzle) => puzzle.difficulty === "intermediate"));
});

test("every KataGo line is legal from its historical 19x19 position", () => {
  for (const puzzle of gokyoShumyoPuzzles()) {
    assert.equal(puzzle.board.length, 19, puzzle.sourceId);
    assert.equal(puzzle.board[puzzle.solution.y]?.[puzzle.solution.x], null, puzzle.sourceId);
    assert.ok(puzzle.variation.mainLine.length >= 1, puzzle.sourceId);
    assert.ok(puzzle.variation.mainLine.length <= 5, puzzle.sourceId);
    let board = puzzle.board;
    let color = puzzle.toPlay;
    for (const ply of puzzle.variation.mainLine) {
      assert.equal(ply.color, color, puzzle.sourceId);
      const moved = applyMove(board, color, ply.x, ply.y);
      assert.equal(moved.ok, true, puzzle.sourceId);
      if (!moved.ok) break;
      board = moved.board;
      color = color === "black" ? "white" : "black";
    }
  }
});

test("every generated answer stays inside its historical local diagram", () => {
  for (const puzzle of gokyoShumyoPuzzles()) {
    assert.ok(localPuzzleViewportSize(puzzle.board) < 19, puzzle.sourceId);
    const occupied = puzzle.board.flatMap((row, y) => row.flatMap((stone, x) => (
      stone ? [{ x, y }] : []
    )));
    const maxX = Math.max(...occupied.map(({ x }) => x));
    const maxY = Math.max(...occupied.map(({ y }) => y));
    const generatedMoves = [
      ...puzzle.variation.mainLine,
      ...puzzle.variation.refutations.flatMap(({ userMove, reply }) => (
        reply ? [userMove, reply] : [userMove]
      )),
    ];
    for (const move of generatedMoves) {
      assert.ok(move.x <= maxX && move.y <= maxY, `${puzzle.sourceId}: ${move.move}`);
    }
  }
});
