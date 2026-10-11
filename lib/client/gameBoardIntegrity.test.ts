import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, boardHash, createEmptyBoard, replayMoves, replayMovesWithPrisoners } from "@/lib/game/goEngine";
import { captureIncidentHashes, captureIncidentMoves } from "@/lib/game/fixtures/captureIncident9x9";
import { replayJapaneseNormalPlayBoardLegality } from "@/lib/game/japaneseKo";
import { gameBoardMatchesHistory } from "./gameBoardIntegrity";

function snapshot(count: number) {
  const moves = captureIncidentMoves.slice(0, count);
  return { boardSize: 9 as const, moveCount: count, moves, board: replayMoves(9, moves) };
}

test("the reported 48-move incident matches every persisted board hash and legally captures D9 at move 38", () => {
  let current = snapshot(0);
  for (let count = 1; count <= 48; count++) {
    const next = snapshot(count);
    assert.equal(boardHash(next.board), captureIncidentHashes[count - 1], `move ${count}`);
    assert.equal(gameBoardMatchesHistory(current, next), true, `move ${count}`);
    current = next;
  }
  const before = snapshot(37);
  assert.equal(before.board[0][3], "black");
  const capture = applyMove(before.board, "white", 2, 0);
  assert.ok(capture.ok);
  assert.deepEqual(capture.captured, [{ x: 3, y: 0 }]);
  assert.equal(snapshot(38).board[0][3], null);
  assert.equal(snapshot(40).board[0][3], "white", "D9 is later occupied by a real white move");
  assert.deepEqual(snapshot(46).board, snapshot(48).board, "passes never remove stones");
  assert.deepEqual(replayMovesWithPrisoners(9, captureIncidentMoves).prisoners,
    { capturedWhiteByBlack: 0, capturedBlackByWhite: 1 });
  assert.equal(boardHash(replayJapaneseNormalPlayBoardLegality(9,
    captureIncidentMoves.map((move, index) => ({ ...move, boardHash: captureIncidentHashes[index] }))).board.map(row => [...row])),
  captureIncidentHashes.at(-1));
});

test("a full response cannot silently remove or invent a stone", () => {
  const current = snapshot(37);
  const next = snapshot(38);
  const missing = snapshot(38);
  missing.board[4][6] = null;
  const invented = snapshot(38);
  invented.board[0][3] = "black";
  for (const corrupt of [missing, invented]) {
    assert.equal(gameBoardMatchesHistory(current, corrupt), false);
    assert.equal(gameBoardMatchesHistory(null, corrupt), false);
  }
  assert.equal(gameBoardMatchesHistory(current, next), true);
  assert.equal(current.board[4][6], "white", "validation never mutates the accepted board");
});

test("clock refreshes, scoring, missed moves and takebacks keep legal boards", () => {
  const current = snapshot(38);
  assert.equal(gameBoardMatchesHistory(current, { ...current, board: current.board.map(row => [...row]) }), true);
  assert.equal(gameBoardMatchesHistory(current, snapshot(48)), true);
  assert.equal(gameBoardMatchesHistory(current, snapshot(36)), true);
  assert.equal(gameBoardMatchesHistory(null, snapshot(48)), true);
});

test("malformed or illegal appended moves and mismatched counts are rejected", () => {
  const current = snapshot(37);
  const next = snapshot(38);
  for (const changed of [
    { ...next, moveCount: 39 }, { ...next, board: createEmptyBoard(9).slice(0, 8) },
    ...[
      { moveNumber: 39 }, { x: 1.5 }, { x: -1 }, { x: 4, y: 4 },
      { isPass: true }, { x: null, y: null },
    ].map(change => ({ ...next, moves: [...next.moves.slice(0, -1), { ...next.moves.at(-1)!, ...change }] })),
  ]) assert.equal(gameBoardMatchesHistory(current, changed), false);
});
