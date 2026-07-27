import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMove,
  boardHash,
  countLiberties,
  createEmptyBoard,
  getGroup,
  replayMoves,
  scoreChinese,
} from "./goEngine";

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

test("scores stones, surrounded territory, and komi with Chinese area scoring", () => {
  const board = createEmptyBoard(9);
  board[3][4] = "black";
  board[4][3] = "black";
  board[4][5] = "black";
  board[5][4] = "black";
  board[8][8] = "white";

  const score = scoreChinese(board, 0.5);
  assert.equal(score.black, 5);
  assert.equal(score.white, 1.5);
  assert.equal(score.winner, "black");
  assert.equal(score.result, "B+3.5");
});
