import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMove,
  boardHash,
  countLiberties,
  createEmptyBoard,
  getGroup,
  replayMoves,
  replayMovesWithPrisoners,
  scoreChinese,
} from "./goEngine";
import type { StoredMove } from "./types";

test("creates empty boards at every supported size", () => {
  for (const size of [9, 13, 19] as const) {
    const board = createEmptyBoard(size);
    assert.equal(board.length, size);
    assert.equal(board.every((row) => row.length === size), true);
    assert.equal(board.flat().every((point) => point === null), true);
  }
});

test("finds connected groups and counts unique liberties", () => {
  const board = createEmptyBoard(9);
  board[3][3] = "black";
  board[3][4] = "black";

  const group = getGroup(board, { x: 3, y: 3 });
  assert.equal(group.length, 2);
  assert.equal(countLiberties(board, group), 6);
});

test("captures an opponent group without mutating the input board", () => {
  const board = createEmptyBoard(9);
  board[1][1] = "white";
  board[0][1] = "black";
  board[1][0] = "black";
  board[2][1] = "black";

  const result = applyMove(board, "black", 2, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.captured, [{ x: 1, y: 1 }]);
  assert.equal(result.board[1][1], null);
  assert.equal(board[1][1], "white");
});

test("rejects suicide moves", () => {
  const board = createEmptyBoard(9);
  board[0][1] = "white";
  board[1][0] = "white";
  board[1][2] = "white";
  board[2][1] = "white";

  const result = applyMove(board, "black", 1, 1);
  assert.deepEqual(result, { ok: false, board, error: "suicide" });
});

test("replays stored moves and creates a stable board hash", () => {
  const board = replayMoves(9, [
    { moveNumber: 1, color: "black", x: 2, y: 2, isPass: false, createdAt: "" },
    { moveNumber: 2, color: "white", x: null, y: null, isPass: true, createdAt: "" },
    { moveNumber: 3, color: "black", x: 3, y: 2, isPass: false, createdAt: "" },
  ]);

  assert.equal(board[2][2], "black");
  assert.equal(board[2][3], "black");
  assert.equal(boardHash(board), boardHash(board.map((row) => [...row])));
});

test("replays captures into a prisoner ledger without changing the board contract", () => {
  const moves: StoredMove[] = [
    { moveNumber: 1, color: "black", x: 1, y: 0, isPass: false, createdAt: "" },
    { moveNumber: 2, color: "white", x: 0, y: 0, isPass: false, createdAt: "" },
    { moveNumber: 3, color: "black", x: 0, y: 1, isPass: false, createdAt: "" },
    { moveNumber: 4, color: "white", x: null, y: null, isPass: true, createdAt: "" },
  ];
  const replayed = replayMovesWithPrisoners(9, moves);
  assert.equal(replayed.board[0][0], null);
  assert.deepEqual(replayed.prisoners, {
    capturedWhiteByBlack: 1,
    capturedBlackByWhite: 0,
  });
  assert.deepEqual(replayMoves(9, moves), replayed.board);
  assert.equal(Object.isFrozen(replayed.prisoners), true);
  assert.equal(Object.isFrozen(replayed.positionHistory), true);
  assert.equal(replayed.positionHistory.length, moves.length + 1);
  assert.equal(
    replayed.positionHistory.at(-1),
    replayed.positionHistory.at(-2),
    "a pass must preserve an explicit position-history entry",
  );
});

test("rejects malformed persisted pass coordinates before replay", () => {
  assert.throws(
    () => replayMovesWithPrisoners(9, [
      { moveNumber: 1, color: "black", x: 0, y: 0, isPass: true, createdAt: "" },
    ]),
    /Stored pass 1 has coordinates/,
  );
  assert.throws(
    () => replayMovesWithPrisoners(9, [
      { moveNumber: 1, color: "black", x: null, y: null, isPass: false, createdAt: "" },
    ]),
    /Stored move 1 has no coordinates/,
  );

  assert.throws(
    () => replayMovesWithPrisoners(9, [{
      moveNumber: 1,
      color: "red",
      x: 0,
      y: 0,
      isPass: false,
      createdAt: "",
    } as unknown as StoredMove]),
    /Stored move 1 has an invalid color/,
  );
  assert.throws(
    () => replayMovesWithPrisoners(9, [{
      moveNumber: 1,
      color: "black",
      x: 0,
      y: 0,
      isPass: null,
      createdAt: "",
    } as unknown as StoredMove]),
    /Stored move 1 has a non-boolean pass flag/,
  );
  assert.throws(
    () => replayMovesWithPrisoners(9, [{
      moveNumber: 1,
      color: "black",
      x: 0.5,
      y: 0,
      isPass: false,
      createdAt: "",
    } as StoredMove]),
    /Stored move 1 has non-integer coordinates/,
  );
});

test("replay derives multi-stone and White capture totals independently", () => {
  const blackCapture: StoredMove[] = [
    { moveNumber: 1, color: "black", x: 0, y: 1, isPass: false, createdAt: "" },
    { moveNumber: 2, color: "white", x: 1, y: 1, isPass: false, createdAt: "" },
    { moveNumber: 3, color: "black", x: 2, y: 1, isPass: false, createdAt: "" },
    { moveNumber: 4, color: "white", x: 1, y: 2, isPass: false, createdAt: "" },
    { moveNumber: 5, color: "black", x: 0, y: 2, isPass: false, createdAt: "" },
    { moveNumber: 6, color: "white", x: 8, y: 8, isPass: false, createdAt: "" },
    { moveNumber: 7, color: "black", x: 2, y: 2, isPass: false, createdAt: "" },
    { moveNumber: 8, color: "white", x: 8, y: 7, isPass: false, createdAt: "" },
    { moveNumber: 9, color: "black", x: 1, y: 0, isPass: false, createdAt: "" },
    { moveNumber: 10, color: "white", x: 7, y: 8, isPass: false, createdAt: "" },
    { moveNumber: 11, color: "black", x: 1, y: 3, isPass: false, createdAt: "" },
  ];
  assert.deepEqual(replayMovesWithPrisoners(9, blackCapture).prisoners, {
    capturedWhiteByBlack: 2,
    capturedBlackByWhite: 0,
  });

  const whiteCapture: StoredMove[] = [
    { moveNumber: 1, color: "black", x: 0, y: 0, isPass: false, createdAt: "" },
    { moveNumber: 2, color: "white", x: 1, y: 0, isPass: false, createdAt: "" },
    { moveNumber: 3, color: "black", x: 8, y: 8, isPass: false, createdAt: "" },
    { moveNumber: 4, color: "white", x: 0, y: 1, isPass: false, createdAt: "" },
  ];
  assert.deepEqual(replayMovesWithPrisoners(9, whiteCapture).prisoners, {
    capturedWhiteByBlack: 0,
    capturedBlackByWhite: 1,
  });

  const capturesByBoth: StoredMove[] = [
    { moveNumber: 1, color: "black", x: 0, y: 0, isPass: false, createdAt: "" },
    { moveNumber: 2, color: "white", x: 1, y: 0, isPass: false, createdAt: "" },
    { moveNumber: 3, color: "black", x: 8, y: 8, isPass: false, createdAt: "" },
    { moveNumber: 4, color: "white", x: 0, y: 1, isPass: false, createdAt: "" },
    { moveNumber: 5, color: "black", x: 7, y: 7, isPass: false, createdAt: "" },
    { moveNumber: 6, color: "white", x: 8, y: 7, isPass: false, createdAt: "" },
    { moveNumber: 7, color: "black", x: 8, y: 6, isPass: false, createdAt: "" },
  ];
  assert.deepEqual(replayMovesWithPrisoners(9, capturesByBoth).prisoners, {
    capturedWhiteByBlack: 1,
    capturedBlackByWhite: 1,
  });
});

test("replay rejects non-monotone numbers but accepts policy-authorized resume turns", () => {
  assert.throws(
    () => replayMovesWithPrisoners(9, [
      { moveNumber: 2, color: "black", x: 0, y: 0, isPass: false, createdAt: "" },
    ]),
    /expected 1, received 2/,
  );

  const resumedMoves: StoredMove[] = [
    { moveNumber: 1, color: "black", x: null, y: null, isPass: true, createdAt: "" },
    { moveNumber: 2, color: "white", x: null, y: null, isPass: true, createdAt: "" },
    { moveNumber: 3, color: "white", x: 0, y: 0, isPass: false, createdAt: "" },
  ];
  assert.equal(replayMovesWithPrisoners(9, resumedMoves).board[0][0], "white");
});

test("scores stones, surrounded territory, and komi with Chinese area scoring", () => {
  const board = createEmptyBoard(9);
  board[3][4] = "black";
  board[4][3] = "black";
  board[4][5] = "black";
  board[5][4] = "black";
  board[8][8] = "white";

  const score = scoreChinese(board, 0.5);
  assert.equal(score.blackStones, 4);
  assert.equal(score.whiteStones, 1);
  assert.equal(score.blackTerritory, 1);
  assert.equal(score.whiteTerritory, 0);
  assert.equal(score.neutralPoints, 75);
  assert.equal(score.black, 42.5);
  assert.equal(score.white, 39);
  assert.equal(score.winner, "black");
  assert.equal(score.result, "B+3.5");
});

test("splits an odd number of neutral dame points equally", () => {
  const board = [
    ["black", null, "white"],
    ["black", null, "white"],
    ["black", null, "white"],
  ] as const;

  const score = scoreChinese(board.map((row) => [...row]), 0);
  assert.equal(score.neutralPoints, 3);
  assert.equal(score.black, 4.5);
  assert.equal(score.white, 4.5);
  assert.equal(score.result, "Draw");
});

test("counts living seki stones while leaving their shared liberties neutral", () => {
  const board = [
    ["black", "black", "white"],
    ["black", null, "white"],
    [null, "white", "white"],
  ] as const;

  const score = scoreChinese(board.map((row) => [...row]), 0);
  assert.equal(score.blackStones, 3);
  assert.equal(score.whiteStones, 4);
  assert.equal(score.neutralPoints, 2);
  assert.equal(score.blackTerritory, 0);
  assert.equal(score.whiteTerritory, 0);
  assert.equal(score.result, "W+1");
});

test("uses the explicitly supplied 7.5 komi for current Chinese games", () => {
  const score = scoreChinese(createEmptyBoard(9), 7.5);
  assert.equal(score.result, "W+7.5");
});
