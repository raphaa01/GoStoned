import assert from "node:assert/strict";
import test from "node:test";
import { currentJapaneseWholeBoardRepetition } from "./japaneseRepetition";

const hash = (digit: string) => digit === "1" ? "B../.../..." : digit === "2" ? ".W./.../..." : ".../B../...";

test("recognizes a placement that recreates an earlier whole-board position", () => {
  assert.deepEqual(currentJapaneseWholeBoardRepetition([
    { moveNumber: 1, color: "black", isPass: false, boardHash: hash("1") },
    { moveNumber: 2, color: "white", isPass: false, boardHash: hash("2") },
    { moveNumber: 3, color: "black", isPass: false, boardHash: hash("3") },
    { moveNumber: 4, color: "white", isPass: false, boardHash: hash("1") },
  ]), {
    moveNumber: 4,
    repeatedFromMoveNumber: 1,
    boardHash: hash("1"),
  });
});

test("a pass is not a whole-board repetition claim boundary", () => {
  assert.equal(currentJapaneseWholeBoardRepetition([
    { moveNumber: 1, color: "black", isPass: false, boardHash: hash("1") },
    { moveNumber: 2, color: "white", isPass: true, boardHash: hash("1") },
  ]), null);
});

test("uses the nearest prior occurrence and rejects malformed evidence", () => {
  assert.deepEqual(currentJapaneseWholeBoardRepetition([
    { moveNumber: 1, color: "black", isPass: false, boardHash: hash("1") },
    { moveNumber: 2, color: "white", isPass: false, boardHash: hash("2") },
    { moveNumber: 3, color: "black", isPass: false, boardHash: hash("1") },
    { moveNumber: 4, color: "white", isPass: false, boardHash: hash("2") },
    { moveNumber: 5, color: "black", isPass: false, boardHash: hash("1") },
  ])?.repeatedFromMoveNumber, 3);
  assert.equal(currentJapaneseWholeBoardRepetition([
    { moveNumber: 1, color: "black", isPass: false, boardHash: "not-a-hash" },
  ]), null);
});
