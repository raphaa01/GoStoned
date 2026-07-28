import assert from "node:assert/strict";
import test from "node:test";
import { getRecentGameRatingPresentation } from "./ratingPresentation";

test("unrated games never expose a partial historical rating change", () => {
  assert.deepEqual(
    getRecentGameRatingPresentation({ rated: false, ratingChange: -16 }),
    { kind: "unrated" },
  );
});

test("rated games distinguish recorded changes from missing historical deltas", () => {
  assert.deepEqual(
    getRecentGameRatingPresentation({ rated: true, ratingChange: 16 }),
    { kind: "change", value: 16 },
  );
  assert.deepEqual(
    getRecentGameRatingPresentation({ rated: true, ratingChange: null }),
    { kind: "rated" },
  );
});
