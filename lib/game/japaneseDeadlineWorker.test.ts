import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_JAPANESE_DEADLINE_BATCH,
  japaneseDeadlineBatchSize,
} from "./japaneseDeadlineWorker";

test("deadline worker batch policy is bounded and server configurable", () => {
  assert.equal(japaneseDeadlineBatchSize(undefined), DEFAULT_JAPANESE_DEADLINE_BATCH);
  assert.equal(japaneseDeadlineBatchSize("1"), 1);
  assert.equal(japaneseDeadlineBatchSize("100"), 100);
  for (const invalid of ["0", "101", "1.5", "-1", "nope"]) {
    assert.throws(() => japaneseDeadlineBatchSize(invalid), /must be/);
  }
});
