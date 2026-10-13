import assert from "node:assert/strict";
import test from "node:test";
import { captureIncidentMoves, captureIncidentHashes } from "./fixtures/captureIncident9x9";
import { boardHash, createEmptyBoard } from "./goEngine";
import { finishedGamePosition } from "./finishedGameReplay";
import { sharedGameUrl } from "./sharedGameUrl";

test("finished replay restores every recorded position, captures and passes without changing the game", () => {
  const original = JSON.stringify(captureIncidentMoves);
  assert.deepEqual(finishedGamePosition(9, captureIncidentMoves, 0).board, createEmptyBoard(9));
  for (let index = 1; index <= captureIncidentMoves.length; index++) {
    assert.equal(boardHash(finishedGamePosition(9, captureIncidentMoves, index).board), captureIncidentHashes[index - 1]);
  }
  assert.equal(finishedGamePosition(9, captureIncidentMoves, 37).board[0][3], "black");
  assert.equal(finishedGamePosition(9, captureIncidentMoves, 38).board[0][3], null);
  assert.equal(finishedGamePosition(9, captureIncidentMoves, 48).lastMove, null);
  assert.equal(JSON.stringify(captureIncidentMoves), original);
});

test("replay bounds include empty games and jumps to the start/end", () => {
  assert.equal(finishedGamePosition(9, [], 0).lastMove, null);
  assert.equal(finishedGamePosition(9, captureIncidentMoves, -1).moveIndex, 0);
  assert.equal(finishedGamePosition(9, captureIncidentMoves, 999).moveIndex, 48);
});

test("share URLs use the public app origin rather than a deployment or native origin", () => {
  assert.equal(sharedGameUrl("token", "http://localhost:3000", "https://gostone.app/"), "https://gostone.app/shared-game/token");
  assert.equal(sharedGameUrl("token", "https://preview.test", ""), "https://preview.test/shared-game/token");
});
