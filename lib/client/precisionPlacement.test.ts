import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_GRID_INSET_RATIO,
  BOARD_GRID_SPAN_RATIO,
  boardPositionFromClientPoint,
  touchLensCoordinates,
} from "./precisionPlacement";

test("the board grid is symmetrical inside its wooden surface", () => {
  assert.equal(BOARD_GRID_INSET_RATIO, 0.07);
  assert.equal(BOARD_GRID_INSET_RATIO * 2 + BOARD_GRID_SPAN_RATIO, 1);
});

test("board-surface touch coordinates map to the nearest Go intersection", () => {
  const bounds = { left: 10, top: 20, width: 380, height: 380 };
  assert.deepEqual(boardPositionFromClientPoint(36.6, 46.6, bounds, 19), { x: 0, y: 0 });
  assert.deepEqual(boardPositionFromClientPoint(200, 210, bounds, 19), { x: 9, y: 9 });
  assert.deepEqual(boardPositionFromClientPoint(363.4, 373.4, bounds, 19), { x: 18, y: 18 });
  assert.deepEqual(boardPositionFromClientPoint(10, 20, bounds, 19), { x: 0, y: 0 });
  assert.equal(
    boardPositionFromClientPoint(10, 20, { ...bounds, width: 0 }, 19),
    null,
  );
});

test("the touch lens always describes a centered seven by seven neighborhood", () => {
  const center = touchLensCoordinates({ x: 9, y: 9 }, 19);
  assert.equal(center.length, 49);
  assert.deepEqual(center[0], { x: 6, y: 6 });
  assert.deepEqual(center[24], { x: 9, y: 9 });
  assert.deepEqual(center[48], { x: 12, y: 12 });

  const corner = touchLensCoordinates({ x: 0, y: 0 }, 19);
  assert.equal(corner.length, 49);
  assert.equal(corner[0], null);
  assert.deepEqual(corner[24], { x: 0, y: 0 });
  assert.deepEqual(corner[48], { x: 3, y: 3 });
});
