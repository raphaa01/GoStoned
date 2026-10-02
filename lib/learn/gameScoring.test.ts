import assert from "node:assert/strict";
import test from "node:test";
import { GOSTONE_BOT_MODEL } from "@/lib/bot/modelV1";
import { scoreLearnGame } from "./gameScoring";
import type { Position } from "@/lib/game/types";

test("learning settlement requires two consecutive passes and rejects illegal records", () => {
  assert.throws(() => scoreLearnGame([{x: 0, y: 0}, null], [], []), /two_passes_required/);
  assert.throws(() => scoreLearnGame([{x: 0, y: 0}, {x: 0, y: 0}, null, null], [], []), /illegal_game_record/);
  assert.throws(() => scoreLearnGame([null, null], [{x: 0, y: 0}], []));
  const empty = scoreLearnGame([null, null], [], []);
  assert.equal(empty.score.komi, GOSTONE_BOT_MODEL.komi);
  assert.equal(empty.score.whiteTotal, GOSTONE_BOT_MODEL.komi);
  assert.equal(empty.blackTerritory.length, 0);
});

test("the learning score derives captures from moves and marks each counted point", () => {
  const moves: (Position | null)[] = [{x: 1, y: 0}, {x: 0, y: 0}, {x: 0, y: 1}, {x: 8, y: 8}, null, null];
  const result = scoreLearnGame(moves, [], []);
  assert.equal(result.score.capturedWhiteByBlack, 1);
  assert.equal(result.board[0][0], null);
  assert.equal(result.blackTerritory.length, result.score.blackTerritory);
  assert.equal(result.whiteTerritory.length, result.score.whiteTerritory);
  assert.deepEqual(result.blackTerritory, [{x: 0, y: 0}]);
  const neutral = scoreLearnGame(moves, [], [{x: 0, y: 0}]);
  assert.equal(neutral.score.blackTerritory, 0);
  assert.equal(neutral.blackTerritory.length, 0);
});

test("the server validates agreed dead groups instead of accepting a client score", () => {
  const moves: (Position | null)[] = [{x: 1, y: 0}, {x: 0, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}, {x: 1, y: 2}, {x: 8, y: 8}, {x: 0, y: 3}, {x: 8, y: 7}, null, null];
  assert.throws(() => scoreLearnGame(moves, [{x: 0, y: 0}], []));
  const dead = scoreLearnGame(moves, [{x: 0, y: 0}, {x: 0, y: 1}], []);
  assert.equal(dead.score.deadWhiteAwardedToBlack, 2);
  assert.equal(dead.score.blackTerritory, 3);
  assert.equal(dead.score.blackTotal, 5);
});
