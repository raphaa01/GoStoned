import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard } from "./goEngine";
import { toJapaneseTerritoryPreview } from "./japaneseGameScoring";
import { scoreJapaneseTerritory } from "./japaneseScoring";

test("presents Japanese territory and prisoners without counting living stones", () => {
  const board = createEmptyBoard(9);
  board[0][0] = "black";
  board[0][1] = "black";
  board[1][0] = "black";
  board[1][1] = "white";
  const score = scoreJapaneseTerritory({
    board,
    prisoners: { capturedWhiteByBlack: 2, capturedBlackByWhite: 1 },
    deadStones: [{ x: 1, y: 1 }],
    agreedNeutralRegionSeeds: [],
    komi: 6.5,
  });

  const preview = toJapaneseTerritoryPreview(score);
  assert.equal(preview.black, score.blackTerritory + 3);
  assert.equal(preview.white, score.whiteTerritory + 1 + 6.5);
  assert.equal(preview.blackStones, 3);
  assert.equal(preview.blackPrisoners, 3);
  assert.equal(preview.whitePrisoners, 1);
  assert.equal(preview.result, `B+${preview.margin}`);
  assert.equal(Object.isFrozen(preview), true);
});

test("presents an empty Japanese board as a komi win and all dame", () => {
  const score = scoreJapaneseTerritory({
    board: createEmptyBoard(9),
    prisoners: { capturedWhiteByBlack: 0, capturedBlackByWhite: 0 },
    deadStones: [],
    agreedNeutralRegionSeeds: [],
    komi: 6.5,
  });
  assert.deepEqual(toJapaneseTerritoryPreview(score), {
    black: 0,
    white: 6.5,
    blackStones: 0,
    whiteStones: 0,
    blackTerritory: 0,
    whiteTerritory: 0,
    neutralPoints: 81,
    territoryExcludedByAgreement: 0,
    blackPrisoners: 0,
    whitePrisoners: 0,
    winner: "white",
    margin: 6.5,
    result: "W+6.5",
  });
});
