import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard } from "./goEngine";
import {
  groupMarkedDeadStones,
  removeDeadStones,
  resumeTurnForClaim,
  scoreChineseAgreement,
  scoringDeadlineExpired,
  toggleDeadGroup,
} from "./scoring";

test("marked dead stones are presented as distinct selectable groups", () => {
  const board = createEmptyBoard(9);
  board[1][1] = "black";
  board[1][2] = "black";
  board[6][6] = "white";

  assert.deepEqual(
    groupMarkedDeadStones(board, [
      { x: 6, y: 6 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
    ]),
    [
      {
        key: "1:1",
        color: "black",
        stones: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
        representative: { x: 1, y: 1 },
      },
      {
        key: "6:6",
        color: "white",
        stones: [{ x: 6, y: 6 }],
        representative: { x: 6, y: 6 },
      },
    ],
  );
});

test("dead-stone proposals always toggle an entire connected group", () => {
  const board = createEmptyBoard(9);
  board[1][1] = "white";
  board[1][2] = "white";
  board[2][2] = "white";

  const marked = toggleDeadGroup(board, [], { x: 1, y: 1 }, true);
  assert.equal(marked.changed, true);
  assert.deepEqual(marked.deadStones, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
  ]);

  const restored = toggleDeadGroup(board, marked.deadStones, { x: 2, y: 2 }, false);
  assert.equal(restored.changed, true);
  assert.deepEqual(restored.deadStones, []);
});

test("dead-stone proposals reject empty intersections", () => {
  const board = createEmptyBoard(9);
  assert.throws(
    () => toggleDeadGroup(board, [], { x: 4, y: 4 }, true),
    /Only a stone group/,
  );
});

test("Chinese agreement scoring removes dead stones without adding prisoners", () => {
  const board = createEmptyBoard(9);
  board[0][0] = "black";
  board[0][1] = "black";
  board[1][0] = "black";
  board[1][1] = "white";

  const dead = [{ x: 1, y: 1 }];
  const scoredBoard = removeDeadStones(board, dead);
  assert.equal(scoredBoard[1][1], null);
  assert.equal(board[1][1], "white", "the stopped position must remain immutable");

  const score = scoreChineseAgreement(board, dead, 7.5);
  assert.equal(score.black, 81);
  assert.equal(score.white, 7.5);
  assert.equal(score.result, "B+73.5");
});

test("Chinese dispute resumption gives the first move to the player claiming death", () => {
  assert.equal(resumeTurnForClaim("black", "dead"), "black");
  assert.equal(resumeTurnForClaim("black", "alive"), "white");
  assert.equal(resumeTurnForClaim("white", "dead"), "white");
  assert.equal(resumeTurnForClaim("white", "alive"), "black");
});

test("the scoring decision deadline expires at an exact server timestamp", () => {
  const deadline = new Date("2026-01-01T00:10:00.000Z");
  assert.equal(scoringDeadlineExpired(deadline, new Date("2026-01-01T00:09:59.999Z")), false);
  assert.equal(scoringDeadlineExpired(deadline, new Date("2026-01-01T00:10:00.000Z")), true);
});
