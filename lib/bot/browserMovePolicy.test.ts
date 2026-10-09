import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, boardHash, createEmptyBoard, replayMovesWithPrisoners } from "@/lib/game/goEngine";
import type { BoardSize, Position, StoredMove } from "@/lib/game/types";
import { chooseBrowserBotMove, shouldBrowserBotPass } from "./browserMovePolicy";
import { GOSTONE_BOT_MODEL, type GoStoneBotPosition } from "./modelV1";

function fixture(boardSize: BoardSize, placements: number, humanPass: boolean): GoStoneBotPosition {
  let board = createEmptyBoard(boardSize);
  const moves: StoredMove[] = [];
  for (let index = 0; index < placements; index += 1) {
    const color = index % 2 === 0 ? "black" : "white";
    const x = index % boardSize;
    const y = Math.floor(index / boardSize);
    const applied = applyMove(board, color, x, y);
    assert.ok(applied.ok);
    board = applied.board;
    moves.push({ moveNumber: moves.length + 1, color, x, y, isPass: false, createdAt: "" });
  }
  let toMove = placements % 2 === 0 ? "black" as const : "white" as const;
  if (humanPass) {
    moves.push({ moveNumber: moves.length + 1, color: toMove, x: null, y: null, isPass: true, createdAt: "" });
    toMove = toMove === "black" ? "white" : "black";
  }
  return { gameId: "pass-regression", boardSize, board, moves, toMove, komi: 6.5, targetRating: 500, gameVersion: moves.length };
}

const settledOwnership = new Float32Array(361).fill(0.9);
function policyWithPass(passLogit: number) {
  const policy = new Float32Array(362).fill(0);
  policy[GOSTONE_BOT_MODEL.passIndex] = passLogit;
  return policy;
}

test("even overwhelming model passes and opponent passes cannot end the opening on any board", () => {
  for (const size of [9, 13, 19] as const) {
    for (const placements of [0, 4, Math.ceil(size ** 2 * 0.4) - 1]) {
      for (const humanPass of [false, true]) {
        const position = fixture(size, placements, humanPass);
        assert.equal(shouldBrowserBotPass(position, 100, 0, settledOwnership), false);
        const move = chooseBrowserBotMove(position, policyWithPass(100), settledOwnership, "v8");
        assert.equal(move.kind, "play");
      }
    }
  }
});

test("repeated human passes do not count as board development", () => {
  const position = fixture(9, 4, true);
  const moves = [...position.moves];
  for (let index = 0; index < 100; index += 1) {
    moves.push({ moveNumber: moves.length + 1, color: index % 2 ? "black" : "white", x: null, y: null, isPass: true, createdAt: "" });
  }
  assert.equal(shouldBrowserBotPass({ ...position, moves }, 100, 0, settledOwnership), false);
});

test("a player pass tips a close settled endgame without overriding a useful move", () => {
  for (const size of [9, 13, 19] as const) {
    const placements = Math.ceil(size ** 2 * 0.4);
    const active = fixture(size, placements, false);
    const offered = fixture(size, placements, true);
    assert.equal(shouldBrowserBotPass(active, -0.5, 0, settledOwnership), false);
    assert.equal(shouldBrowserBotPass(offered, -0.5, 0, settledOwnership), true);
    assert.equal(shouldBrowserBotPass(offered, -2, 0, settledOwnership), false);
    assert.equal(shouldBrowserBotPass(active, 0.5, 0, settledOwnership), true);
    for (const targetRating of [500, 750, 1000, 1200, 2100]) {
      assert.equal(chooseBrowserBotMove({ ...offered, targetRating }, policyWithPass(-0.5), settledOwnership, "v8").kind, "pass");
      assert.equal(chooseBrowserBotMove({ ...active, targetRating }, policyWithPass(-0.5), settledOwnership, "v8").kind, "play");
    }
  }
});

test("unsettled ownership, missing evidence and a sparse board block premature midgame passes", () => {
  const position = fixture(9, 40, true);
  assert.equal(shouldBrowserBotPass(position, 100, 0, new Float32Array(361)), false);
  assert.equal(shouldBrowserBotPass(position, 100, 0, new Float32Array(0)), false);
  assert.equal(shouldBrowserBotPass(position, NaN, 0, settledOwnership), false);
  assert.equal(shouldBrowserBotPass({ ...position, board: createEmptyBoard(9) }, 100, 0, settledOwnership), false);
});

test("selected beginner moves remain legal, avoid repetition and honor server exclusions", () => {
  const initial = fixture(9, 16, false);
  const policy = policyWithPass(-100);
  const replay = replayMovesWithPrisoners(9, [...initial.moves]);
  for (const rating of [500, 750, 1000, 1200, 2100]) {
    const excludedMoves: Position[] = [];
    for (let retry = 0; retry < 10; retry += 1) {
      const position = { ...initial, targetRating: rating, excludedMoves };
      const move = chooseBrowserBotMove(position, policy, settledOwnership, "v8");
      assert.equal(move.kind, "play");
      if (move.kind !== "play") throw new Error("Expected a legal play");
      assert.ok(!excludedMoves.some(({ x, y }) => x === move.x && y === move.y));
      const applied = applyMove(initial.board, initial.toMove, move.x, move.y);
      assert.ok(applied.ok);
      assert.ok(!replay.positionHistory.includes(boardHash(applied.board)));
      assert.deepEqual(chooseBrowserBotMove(position, policy, settledOwnership, "v8"), move);
      excludedMoves.push({ x: move.x, y: move.y });
    }
  }
});

test("beginner variation does not fill a true eye or put a noncapturing group into self-atari", () => {
  const moves: StoredMove[] = [
    ...[[3, 3], [4, 3], [5, 3], [3, 4], [5, 4], [3, 5], [4, 5], [5, 5]]
      .map(([x, y]) => ({ color: "black" as const, x, y })),
    ...[[0, 1], [1, 0], [2, 1]].map(([x, y]) => ({ color: "white" as const, x, y })),
  ].map((move, index) => ({ ...move, moveNumber: index + 1, isPass: false, createdAt: "" }));
  const board = replayMovesWithPrisoners(9, moves).board;
  const position = { ...fixture(9, 0, false), board, moves, toMove: "black" as const };
  const policy = new Float32Array(362).fill(-100);
  const set = (x: number, y: number, value: number) => { policy[(y + 5) * 19 + x + 5] = value; };
  set(7, 7, 0);
  set(4, 4, -0.1); // True eye.
  set(1, 1, -0.2); // One liberty, no capture.
  set(6, 6, -0.3); // Plausible alternative.
  const seen = new Set<string>();
  for (let gameVersion = 0; gameVersion < 100; gameVersion += 1) {
    const move = chooseBrowserBotMove({ ...position, gameVersion }, policy, settledOwnership, "v8");
    assert.ok(move.kind === "play" && ((move.x === 7 && move.y === 7) || (move.x === 6 && move.y === 6)));
    seen.add(JSON.stringify(move));
  }
  assert.equal(seen.size, 2);
});

test("a model's overwhelming ko recapture preference cannot bypass position history", () => {
  const moves: StoredMove[] = [
    ...[[0, 1], [1, 0], [2, 1]].map(([x, y]) => ({ color: "black" as const, x, y })),
    ...[[1, 1], [0, 2], [2, 2], [1, 3]].map(([x, y]) => ({ color: "white" as const, x, y })),
    { color: "black" as const, x: 1, y: 2 },
  ].map((move, index) => ({ ...move, moveNumber: index + 1, isPass: false, createdAt: "" }));
  const replay = replayMovesWithPrisoners(9, moves);
  const position = { ...fixture(9, 0, false), board: replay.board, moves, toMove: "white" as const };
  const recapture = applyMove(replay.board, "white", 1, 1);
  assert.ok(recapture.ok && replay.positionHistory.includes(boardHash(recapture.board)));
  const policy = policyWithPass(-100);
  policy[6 * 19 + 6] = 100;
  for (const targetRating of [500, 750, 1000, 2100]) {
    const move = chooseBrowserBotMove({ ...position, targetRating }, policy, settledOwnership, "v8");
    assert.ok(move.kind === "play" && (move.x !== 1 || move.y !== 1));
  }
});
