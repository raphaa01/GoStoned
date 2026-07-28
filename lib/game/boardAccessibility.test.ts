import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBoardLabel,
  goColumnLabel,
  goCoordinate,
  isBoardNavigationKey,
  joinBoardLabels,
  moveBoardFocus,
} from "./boardAccessibility";

test("formats authentic Go coordinates with I skipped and rows counted from the bottom", () => {
  assert.equal(goCoordinate(19, 0, 18), "A1");
  assert.equal(goCoordinate(19, 7, 3), "H16");
  assert.equal(goCoordinate(19, 8, 3), "J16");
  assert.equal(goCoordinate(19, 18, 0), "T19");
  assert.equal(goCoordinate(9, 8, 0), "J9");
  assert.equal(goCoordinate(13, 12, 12), "N1");
  assert.equal(goColumnLabel(19, 8), "J");
});

test("joins optional cell states without duplicate spoken whitespace", () => {
  assert.equal(joinBoardLabels("Black stone at Q16.", false, "Last move."), "Black stone at Q16. Last move.");
});

test("rejects coordinates outside the active board", () => {
  assert.throws(() => goCoordinate(9, -1, 0), RangeError);
  assert.throws(() => goCoordinate(9, 9, 0), RangeError);
  assert.throws(() => goCoordinate(9, 0, 9), RangeError);
  assert.throws(() => goCoordinate(9, 0.5, 0), RangeError);
  assert.throws(() => goColumnLabel(9, 9), RangeError);
});

test("fills localized board-label templates without assembling grammar in the component", () => {
  assert.equal(
    formatBoardLabel("{stone} at {coordinate}. {state}", {
      stone: "Black stone",
      coordinate: "Q16",
      state: "Last move.",
    }),
    "Black stone at Q16. Last move.",
  );
});

test("moves board focus without wrapping between rows", () => {
  assert.equal(moveBoardFocus(8, "ArrowRight", 9), 8);
  assert.equal(moveBoardFocus(9, "ArrowLeft", 9), 9);
  assert.equal(moveBoardFocus(10, "ArrowLeft", 9), 9);
  assert.equal(moveBoardFocus(10, "ArrowRight", 9), 11);
  assert.equal(moveBoardFocus(4, "ArrowUp", 9), 4);
  assert.equal(moveBoardFocus(76, "ArrowDown", 9), 76);
  assert.equal(moveBoardFocus(40, "ArrowUp", 9), 31);
  assert.equal(moveBoardFocus(40, "ArrowDown", 9), 49);
});

test("supports row and whole-grid Home and End navigation", () => {
  assert.equal(moveBoardFocus(31, "Home", 9), 27);
  assert.equal(moveBoardFocus(31, "End", 9), 35);
  assert.equal(moveBoardFocus(31, "Home", 9, true), 0);
  assert.equal(moveBoardFocus(31, "End", 9, true), 80);
  assert.equal(moveBoardFocus(31, "Enter", 9), 31);
});

test("identifies every key whose native scrolling must be suppressed on the grid", () => {
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
    assert.equal(isBoardNavigationKey(key), true);
  }
  assert.equal(isBoardNavigationKey("Enter"), false);
  assert.equal(isBoardNavigationKey("Tab"), false);
});
