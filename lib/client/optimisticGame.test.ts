import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard } from "@/lib/game/goEngine";
import { previewPendingMove } from "./optimisticGame";

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

test("an already-confirmed or invalid pending move preserves the server board", () => {
  const board = createEmptyBoard(9);
  board[4][4] = "black";

  assert.deepEqual(previewPendingMove(board, null), { board, applied: false });
  assert.deepEqual(
    previewPendingMove(board, { x: 4, y: 4, color: "black" }),
    { board, applied: false },
  );
});
