import assert from "node:assert/strict";
import test from "node:test";
import {
  activatePrecisionPlacement,
  BOARD_GRID_INSET_RATIO,
  BOARD_GRID_SPAN_RATIO,
  boardPositionFromClientPoint,
  reconcilePrecisionPlacement,
  type PrecisionPlacementContext,
  WHOLE_BOARD,
} from "./precisionPlacement";

test("the board grid is symmetrical inside its wooden surface", () => {
  assert.equal(BOARD_GRID_INSET_RATIO, 0.07);
  assert.equal(BOARD_GRID_INSET_RATIO * 2 + BOARD_GRID_SPAN_RATIO, 1);
});

const context: PrecisionPlacementContext = {
  boardSize: 19,
  disabled: false,
  interactionMode: "play",
  revision: "guest:one:game:4:black:live",
};

test("coarse mobile 19x19 touch requires a guarded second exact activation", () => {
  const first = activatePrecisionPlacement(WHOLE_BOARD, context, {
    x: 12,
    y: 4,
    actionable: true,
    coarseMobile: true,
    pointerType: "touch",
  });
  assert.equal(first.submit, false);
  assert.deepEqual(first.state, {
    kind: "precision",
    position: { x: 12, y: 4 },
    revision: context.revision,
  });

  const adjusted = activatePrecisionPlacement(first.state, context, {
    x: 13,
    y: 5,
    actionable: true,
    coarseMobile: true,
    pointerType: "touch",
  });
  assert.equal(adjusted.submit, false);
  assert.deepEqual(adjusted.state, {
    kind: "precision",
    position: { x: 13, y: 5 },
    revision: context.revision,
  });

  const second = activatePrecisionPlacement(adjusted.state, context, {
    x: 13,
    y: 5,
    actionable: true,
    coarseMobile: true,
    pointerType: "touch",
  });
  assert.equal(second.submit, true);
  assert.deepEqual(second.state, { kind: "submitting", revision: context.revision });

  const duplicate = activatePrecisionPlacement(second.state, context, {
    x: 13,
    y: 5,
    actionable: true,
    coarseMobile: true,
    pointerType: "touch",
  });
  assert.equal(duplicate.submit, false);
  assert.equal(duplicate.state, second.state);
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

test("mouse, pen, keyboard, 9x9, and 13x13 remain direct", () => {
  for (const pointerType of ["mouse", "pen", "keyboard"] as const) {
    assert.equal(activatePrecisionPlacement(WHOLE_BOARD, context, {
      x: 2,
      y: 3,
      actionable: true,
      coarseMobile: true,
      pointerType,
    }).submit, true);
  }
  for (const boardSize of [9, 13] as const) {
    assert.equal(activatePrecisionPlacement(WHOLE_BOARD, { ...context, boardSize }, {
      x: 2,
      y: 3,
      actionable: true,
      coarseMobile: true,
      pointerType: "touch",
    }).submit, true);
  }
  assert.equal(activatePrecisionPlacement(WHOLE_BOARD, context, {
    x: 2,
    y: 3,
    actionable: true,
    coarseMobile: false,
    pointerType: "touch",
  }).submit, true);
});

test("unavailable intersections never arm or submit and keep an active precision choice", () => {
  const precision = activatePrecisionPlacement(WHOLE_BOARD, context, {
    x: 4,
    y: 4,
    actionable: true,
    coarseMobile: true,
    pointerType: "touch",
  }).state;

  const occupied = activatePrecisionPlacement(precision, context, {
    x: 5,
    y: 5,
    actionable: false,
    coarseMobile: true,
    pointerType: "touch",
  });
  assert.equal(occupied.submit, false);
  assert.equal(occupied.state, precision);

  const disabled = activatePrecisionPlacement(precision, { ...context, disabled: true }, {
    x: 5,
    y: 5,
    actionable: true,
    coarseMobile: true,
    pointerType: "touch",
  });
  assert.equal(disabled.submit, false);
  assert.equal(disabled.state.kind, "whole");
});

test("revision, turn availability, phase, and board-size changes cancel stale precision", () => {
  const precision = activatePrecisionPlacement(WHOLE_BOARD, context, {
    x: 8,
    y: 8,
    actionable: true,
    coarseMobile: true,
    pointerType: "touch",
  }).state;

  for (const changed of [
    { ...context, revision: "guest:one:game:5:white:live" },
    { ...context, disabled: true },
    { ...context, interactionMode: "mark-dead" as const },
    { ...context, boardSize: 13 as const },
  ]) {
    assert.equal(reconcilePrecisionPlacement(precision, changed).kind, "whole");
  }
});

test("clock-only heartbeats retain precision while a semantic revision clears it", () => {
  const precision = activatePrecisionPlacement(WHOLE_BOARD, context, {
    x: 10,
    y: 11,
    actionable: true,
    coarseMobile: true,
    pointerType: "touch",
  }).state;

  assert.equal(reconcilePrecisionPlacement(precision, { ...context }), precision);
  assert.equal(reconcilePrecisionPlacement(precision, {
    ...context,
    revision: `${context.revision}:next-turn`,
  }).kind, "whole");
});
