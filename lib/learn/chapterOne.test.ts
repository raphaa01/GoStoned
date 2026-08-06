import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAPTER_ONE_LESSON_IDS,
  CHAPTER_ONE_LESSONS,
  chapterOneCopy,
  GROUP_CAPTURE_MOVE,
  LESSON_BOARD_SIZE,
  LESSON_SETUPS,
  LIBERTY_POINTS,
} from "./chapterOne";

test("chapter one progresses through six distinct Go concepts", () => {
  assert.equal(CHAPTER_ONE_LESSONS.length, 6);
  assert.deepEqual(CHAPTER_ONE_LESSONS.map(({ id }) => id), CHAPTER_ONE_LESSON_IDS);

  for (const locale of ["en", "de"] as const) {
    const copy = chapterOneCopy(locale);
    const titles = CHAPTER_ONE_LESSON_IDS.map((id) => copy.lessons[id].title);
    assert.equal(new Set(titles).size, 6);
    for (const id of CHAPTER_ONE_LESSON_IDS) {
      assert.ok(copy.lessons[id].instruction.length > 0);
      assert.ok(copy.lessons[id].success.length > 0);
    }
  }
});

test("all teaching positions stay inside the compact practice board", () => {
  const positions = [...Object.values(LESSON_SETUPS).flat(), ...LIBERTY_POINTS, GROUP_CAPTURE_MOVE];
  for (const { x, y } of positions) {
    assert.ok(x >= 0 && x < LESSON_BOARD_SIZE);
    assert.ok(y >= 0 && y < LESSON_BOARD_SIZE);
  }
});

test("a centre stone has four orthogonal liberties and no diagonals", () => {
  assert.deepEqual(LIBERTY_POINTS, [
    { x: 2, y: 1 },
    { x: 1, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 3 },
  ]);
});

test("the final exercise presents one two-stone white group", () => {
  const whiteStones = LESSON_SETUPS["capture-group"].filter(({ color }) => color === "white");
  assert.equal(whiteStones.length, 2);
  assert.equal(whiteStones[0].x, whiteStones[1].x);
  assert.equal(Math.abs(whiteStones[0].y - whiteStones[1].y), 1);
});
