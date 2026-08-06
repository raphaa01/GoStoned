import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_PREVIEW_CENTER,
  BOARD_PREVIEW_INSET,
  boardPreviewCoordinates,
  boardPreviewStarPoints,
  boardPreviewStoneRadius,
} from "./boardPreview";
import type { BoardSize } from "./types";

const BOARD_SIZES: BoardSize[] = [9, 13, 19];

test("preview grids are evenly spaced and perfectly symmetric", () => {
  for (const boardSize of BOARD_SIZES) {
    const coordinates = boardPreviewCoordinates(boardSize);
    const step = coordinates[1] - coordinates[0];

    assert.equal(coordinates.length, boardSize);
    assert.equal(coordinates[0], BOARD_PREVIEW_INSET);
    assert.equal(coordinates.at(-1), 100 - BOARD_PREVIEW_INSET);
    assert.equal(coordinates[Math.floor(boardSize / 2)], BOARD_PREVIEW_CENTER);

    coordinates.forEach((coordinate, index) => {
      assert.ok(Math.abs(coordinate + coordinates[boardSize - 1 - index] - 100) < 1e-10);
      if (index > 0) {
        assert.ok(Math.abs((coordinate - coordinates[index - 1]) - step) < 1e-10);
      }
    });
  }
});

test("preview star points and stone proportions match supported Go boards", () => {
  assert.deepEqual(boardPreviewStarPoints(9), [
    { x: 2, y: 2 },
    { x: 6, y: 2 },
    { x: 4, y: 4 },
    { x: 2, y: 6 },
    { x: 6, y: 6 },
  ]);
  assert.equal(boardPreviewStarPoints(13).length, 9);
  assert.equal(boardPreviewStarPoints(19).length, 9);

  for (const boardSize of BOARD_SIZES) {
    const spacing = boardPreviewCoordinates(boardSize)[1] - boardPreviewCoordinates(boardSize)[0];
    assert.ok(boardPreviewStoneRadius(boardSize) < spacing / 2);
  }
});
