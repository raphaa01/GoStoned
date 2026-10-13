import assert from "node:assert/strict";
import test from "node:test";
import { checkLocalGameTime, createLocalGame, playLocalTurn, resignLocalGame, resumeLocalGame } from "./localGame";
import { scoreLocalSettlement } from "./localSettlement";
import type { Position } from "./types";

test("shared-device turns capture stones and illegal moves leave turn and time intact", () => {
  let game = createLocalGame(9, "rapid", 0);
  for (const [index, point] of [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }].entries()) {
    game = playLocalTurn(game, point, 1000 * (index + 1));
  }
  assert.equal(game.board[0][0], null);
  assert.equal(game.clock.turn, "white");
  const rejected = playLocalTurn(game, { x: 0, y: 1 }, 4000);
  assert.equal(rejected.error, "occupied");
  assert.deepEqual(rejected.moves, game.moves);
  assert.deepEqual(rejected.clock, game.clock);
});

test("Japanese ko prevents immediate recapture in a local game", () => {
  let game = createLocalGame(9, "classic", 0);
  const points = [
    { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 0, y: 2 },
    { x: 1, y: 0 }, { x: 2, y: 2 }, { x: 8, y: 8 }, { x: 1, y: 3 }, { x: 1, y: 2 },
  ];
  for (const [index, point] of points.entries()) {
    game = playLocalTurn(game, point, index * 1000);
    assert.equal(game.error, null);
  }
  const recapture = playLocalTurn(game, { x: 1, y: 1 }, 10000);
  assert.equal(recapture.error, "ko");
  assert.equal(recapture.moves.length, 9);
  assert.equal(recapture.clock.turn, "white");
});

test("two passes stop clocks, resuming retains record and requires two fresh passes", () => {
  let game = createLocalGame(13, "blitz", 0);
  game = playLocalTurn(game, null, 1000);
  assert.equal(game.phase, "play");
  game = playLocalTurn(game, null, 2000);
  assert.equal(game.phase, "scoring");
  assert.equal(game.clock.running, false);
  assert.equal(checkLocalGameTime(game, 999999).phase, "scoring");
  game = resumeLocalGame(game, 1000000);
  assert.equal(game.moves.length, 2);
  assert.equal(game.clock.turn, "black");
  game = playLocalTurn(game, null, 1001000);
  assert.equal(game.phase, "play");
  game = playLocalTurn(game, null, 1002000);
  assert.equal(game.phase, "scoring");
});

test("resignation and timeout finish for the other color without accepting another move", () => {
  const fresh = createLocalGame(19, "blitz", 0);
  assert.equal(resignLocalGame(fresh, 1000).result, "W+R");
  const whiteTurn = playLocalTurn(fresh, { x: 9, y: 9 }, 1000);
  assert.equal(resignLocalGame(whiteTurn, 2000).result, "B+R");
  const timedOut = playLocalTurn(fresh, { x: 9, y: 9 }, 360000);
  assert.equal(timedOut.result, "W+T");
  assert.equal(timedOut.moves.length, 0);
});

const settlementBody = {
  boardSize: 9, moves: [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 8, y: 8 }, null, null],
  deadStones: [], neutralRegionSeeds: [], blackAgreed: false, whiteAgreed: false,
};

test("server scoring derives prisoners and requires agreement from both colors", () => {
  const preview = scoreLocalSettlement(settlementBody);
  assert.equal(preview.finalized, false);
  assert.equal(preview.result.score.capturedWhiteByBlack, 1);
  assert.equal(preview.result.score.blackTotal, 2);
  assert.equal(preview.result.score.whiteTotal, 6.5);
  assert.deepEqual(preview.result.score.outcome, { kind: "points", winner: "white", margin: 4.5 });
  assert.equal(scoreLocalSettlement({ ...settlementBody, blackAgreed: true }).finalized, false);
  assert.equal(scoreLocalSettlement({ ...settlementBody, blackAgreed: true, whiteAgreed: true }).finalized, true);
});

test("server refuses client scores, invalid moves, bounds and incomplete dead groups", () => {
  assert.throws(() => scoreLocalSettlement({ ...settlementBody, score: { black: 100 } }));
  assert.throws(() => scoreLocalSettlement({ ...settlementBody, boardSize: 5 }));
  assert.throws(() => scoreLocalSettlement({ ...settlementBody, moves: [{ x: .5, y: 0 }, null, null] }));
  assert.throws(() => scoreLocalSettlement({ ...settlementBody, moves: [{ x: 9, y: 0 }, null, null] }));
  assert.throws(() => scoreLocalSettlement({ ...settlementBody, moves: [{ x: 0, y: 0 }, { x: 0, y: 0 }, null, null] }));
  assert.throws(() => scoreLocalSettlement({ ...settlementBody, moves: [null] }));
  const moves: (Position | null)[] = [{x: 1, y: 0}, {x: 0, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}, {x: 1, y: 2}, {x: 8, y: 8}, {x: 0, y: 3}, {x: 8, y: 7}, null, null];
  assert.throws(() => scoreLocalSettlement({ ...settlementBody, moves, deadStones: [{ x: 0, y: 0 }] }));
  assert.equal(scoreLocalSettlement({ ...settlementBody, moves, deadStones: [{x: 0, y: 0}, {x: 0, y: 1}] }).result.score.blackTotal, 5);
});
