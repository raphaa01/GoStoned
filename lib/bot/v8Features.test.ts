import assert from "node:assert/strict";
import test from "node:test";
import { replayMoves } from "@/lib/game/goEngine";
import type { BoardSize, Stone, StoredMove } from "@/lib/game/types";
import { GOSTONE_BOT_MODEL, type GoStoneBotPosition } from "./modelV1";
import { buildV8Features } from "./v8Features";

function move(moveNumber: number, color: Stone, x: number, y: number): StoredMove {
  return { moveNumber, color, x, y, isPass: false, createdAt: new Date(0).toISOString() };
}

function value(features: Float32Array, plane: number, x: number, y: number, size: BoardSize): number {
  const offset = (19 - size) / 2;
  return features[plane * 361 + (y + offset) * 19 + x + offset];
}

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, `expected ${actual} to be close to ${expected}`);
}

test("the v8 encoder supplies ko, liberties, captures, history, and strength exactly", () => {
  const boardSize = 9;
  const moves = [
    move(1, "black", 0, 1),
    move(2, "white", 0, 0),
    move(3, "black", 8, 8),
    move(4, "white", 2, 0),
    move(5, "black", 7, 7),
    move(6, "white", 1, 1),
    move(7, "black", 1, 0),
  ];
  const position: GoStoneBotPosition = {
    gameId: "v8-features-ko",
    boardSize,
    board: replayMoves(boardSize, moves),
    moves,
    toMove: "white",
    komi: 6.5,
    targetRating: 1_500,
    gameVersion: moves.length,
  };
  const features = buildV8Features(position);
  assert.equal(features.length, 23 * 361);
  assert.equal(value(features, 4, 0, 0, boardSize), 1);
  assert.equal(features[4 * 361], 0, "the centered embedding must leave padded corners inactive");
  assertClose(value(features, 7, 4, 4, boardSize), 0.6);
  assertClose(value(features, 8, 4, 4, boardSize), 1 / 81);
  assert.equal(value(features, 11, 1, 0, boardSize), 1);
  assert.equal(value(features, 12, 0, 0, boardSize), 1, "the captured point is the simple-ko ban");
  assert.equal(value(features, 13, 1, 0, boardSize), 1, "the capturing black stone has one liberty");
  assert.equal(value(features, 16, 2, 0, boardSize), 1, "the white stone has two liberties");
  assert.equal(value(features, 20, 0, 0, boardSize), 1, "history 1 contains the captured white stone");
  assert.equal(value(features, 19, 1, 0, boardSize), 0, "history 1 predates the capturing stone");
  assert.equal(value(features, 22, 2, 0, boardSize), 1, "history 2 preserves the earlier white board");
});

test("all six trained Elo levels reach the model's strength plane unchanged", () => {
  for (const { nominalElo, value: expected } of GOSTONE_BOT_MODEL.strengthProfiles) {
    const boardSize = 13;
    const features = buildV8Features({
      gameId: `strength-${nominalElo}`,
      boardSize,
      board: replayMoves(boardSize, []),
      moves: [],
      toMove: "black",
      komi: 6.5,
      targetRating: nominalElo,
      gameVersion: 0,
    });
    assertClose(value(features, 7, 6, 6, boardSize), expected);
  }
});
