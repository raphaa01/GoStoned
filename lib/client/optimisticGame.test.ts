import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard } from "@/lib/game/goEngine";
import { previewPendingGameMove, previewPendingMove } from "./optimisticGame";

test("a pending move immediately previews the placed stone and its captures", () => {
  const board = createEmptyBoard(9);
  board[0][0] = "white";
  board[0][1] = "black";

  const preview = previewPendingMove(board, { x: 0, y: 1, color: "black" });

  assert.equal(preview.applied, true);
  assert.equal(preview.board[1][0], "black");
  assert.equal(preview.board[0][0], null);
  assert.equal(board[1][0], null, "the authoritative board stays untouched");
  assert.equal(board[0][0], "white", "captures remain rollback-safe");
});

test("a pending capture stays immediate on its base position but cannot erase stones on a newer one", () => {
  const board = createEmptyBoard(9);
  board[0][0] = "white";
  board[0][1] = "black";
  const game = { id: "game", version: 2, status: "active" as const,
    phase: "play" as const, turn: "black" as const, board };
  const pending = { gameId: game.id, baseVersion: 2, x: 0, y: 1, color: "black" as const };
  assert.equal(previewPendingGameMove(game, pending).board[0][0], null);
  const advanced = { ...game, version: 4 };
  assert.deepEqual(previewPendingGameMove(advanced, pending), { board, applied: false });
  assert.equal(board[0][0], "white");
  for (const changed of [
    { ...game, id: "other" }, { ...game, turn: "white" as const },
    { ...game, phase: "scoring" as const }, { ...game, status: "finished" as const },
  ]) assert.deepEqual(previewPendingGameMove(changed, pending), { board, applied: false });
});

test("a delayed pending move cannot resurrect its stone after the opponent captures it", () => {
  const board = createEmptyBoard(9);
  board[0][1] = "white";
  board[1][0] = "white";
  const pending = { gameId: "game", baseVersion: 0, x: 0, y: 0, color: "black" as const };
  const current = { id: "game", version: 2, status: "active" as const,
    phase: "play" as const, turn: "black" as const, board };
  assert.equal(previewPendingMove(board, pending).applied, false, "the captured coordinate is now suicide; a raw UI overlay must also be cleared");
  assert.deepEqual(previewPendingGameMove(current, pending), { board, applied: false });
  assert.equal(board[0][0], null);
});

test("an already-confirmed or invalid pending move preserves the server board", () => {
  const board = createEmptyBoard(9);
  board[4][4] = "black";

  assert.deepEqual(previewPendingMove(board, null), { board, applied: false });
  assert.deepEqual(
    previewPendingMove(board, { x: 4, y: 4, color: "black" }),
    { board, applied: false },
  );
});
