import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAPTER_ONE_LESSON_IDS,
  CHAPTER_ONE_LESSONS,
  chapterOneCopy,
  LESSON_BOARD_SIZE,
  LESSON_SETUPS,
  REGION_EXERCISES,
} from "./chapterOne";

test("chapter one exposes six ordered, translated lessons", () => {
  assert.equal(CHAPTER_ONE_LESSONS.length, 6);
  assert.deepEqual(CHAPTER_ONE_LESSONS.map(({ id }) => id), CHAPTER_ONE_LESSON_IDS);

  for (const locale of ["en", "de"] as const) {
    const copy = chapterOneCopy(locale);
    for (const id of CHAPTER_ONE_LESSON_IDS) {
      assert.ok(copy.lessons[id].title.length > 0);
      assert.ok(copy.lessons[id].instruction.length > 0);
      assert.ok(copy.lessons[id].success.length > 0);
    }
  }
});

test("all teaching positions stay inside the lesson board", () => {
  const positions = [
    ...Object.values(LESSON_SETUPS).flat(),
    ...REGION_EXERCISES.flatMap(({ target, required }) => [target, ...required]),
  ];

  for (const { x, y } of positions) {
    assert.ok(x >= 0 && x < LESSON_BOARD_SIZE);
    assert.ok(y >= 0 && y < LESSON_BOARD_SIZE);
  }
});

test("corner, side, and centre require progressively more stones", () => {
  assert.deepEqual(REGION_EXERCISES.map(({ required }) => required.length), [2, 3, 4]);
});
