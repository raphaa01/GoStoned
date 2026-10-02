import assert from "node:assert/strict";
import test from "node:test";
import type { Board } from "@/lib/game/types";
import { localPuzzleViewportSize } from "./puzzleViewport";

function boardWithStone(size: number, x: number, y: number): Board {
  return Array.from({ length: size }, (_, row) => (
    Array.from({ length: size }, (_, column) => row === y && column === x ? "black" : null)
  ));
}

test("historical corner diagrams show a compact board area with breathing room", () => {
  assert.equal(localPuzzleViewportSize(boardWithStone(19, 4, 4)), 7);
  assert.equal(localPuzzleViewportSize(boardWithStone(19, 8, 6)), 10);
  assert.equal(localPuzzleViewportSize(boardWithStone(19, 18, 18)), 19);
});
