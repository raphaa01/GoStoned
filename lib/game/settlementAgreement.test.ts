import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard } from "./goEngine";
import { countedTerritoryPoints, remainingNeutralRegionSeeds, scoreJapaneseTerritory } from "./japaneseScoring";
import { settlementPositions } from "./settlementAgreement";
import { goStoneSettlementPosition, GOSTONE_BOT_MODEL } from "../bot/modelV1";

test("settlement coordinates reject partial groups, empty groups, duplicates and malformed points", () => {
  const board = createEmptyBoard(9);
  board[1][1] = board[1][2] = "black";
  const full = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
  assert.deepEqual(settlementPositions([...full].reverse(), board, true), full);
  for (const value of [[full[0]], [...full, full[0]], [{ x: 0, y: 0 }], [{ x: 1, y: 1, extra: true }], [{ x: -1, y: 1 }]]) {
    assert.throws(() => settlementPositions(value, board, true));
  }
});

test("territory squares match counted points including dead stones and exclude agreed neutral eyes", () => {
  const board = createEmptyBoard(9);
  board[0][1] = board[1][0] = "black";
  board[2][3] = "white";
  const deadStones = [{ x: 3, y: 2 }];
  const seeds = [{ x: 0, y: 0 }];
  const score = scoreJapaneseTerritory({ board, deadStones, agreedNeutralRegionSeeds: seeds,
    prisoners: { capturedWhiteByBlack: 3, capturedBlackByWhite: 2 }, komi: 6.5 });
  const points = countedTerritoryPoints(board, deadStones, seeds);
  assert.equal(points.black.length, score.blackTerritory);
  assert.equal(points.white.length, score.whiteTerritory);
  assert.ok(points.black.some(({ x, y }) => x === 3 && y === 2));
  assert.ok(!points.black.some(({ x, y }) => x === 0 && y === 0));
  assert.equal(score.territoryExcludedByAgreement, 1);
  assert.equal(score.blackPrisonersFinal, 4);
  assert.equal(score.whiteTotal, 8.5);
  assert.equal(board[2][3], "white", "the stopped board stays unchanged");
  assert.deepEqual(remainingNeutralRegionSeeds(board, [], seeds), seeds, "an unrelated restored group preserves the neutral eye");
  assert.deepEqual(remainingNeutralRegionSeeds(board, deadStones, [...seeds, { x: 1, y: 0 }]), seeds, "a seed now occupied by a live stone is removed");
});

test("mixed borders and empty boards have no owned territory", () => {
  const board = createEmptyBoard(9);
  assert.deepEqual(countedTerritoryPoints(board, []), { black: [], white: [] });
  board[0][0] = "black";
  board[0][1] = "white";
  assert.deepEqual(countedTerritoryPoints(board, []), { black: [], white: [] });
});

test("midgame estimates and final proposals use one evaluation strength and retain the bound artifact", () => {
  for (const rating of [100, 600, 1200, 3000]) {
    const input = { gameId: "test", gameVersion: 5, boardSize: 9 as const, board: createEmptyBoard(9), moves: [],
      komi: 6.5, targetRating: rating, modelVersion: "v4", modelSha256: "bound-artifact" };
    const evaluated = goStoneSettlementPosition(input);
    assert.equal(evaluated.targetRating, GOSTONE_BOT_MODEL.settlement.evaluationRating);
    assert.equal(evaluated.modelVersion, input.modelVersion);
    assert.equal(evaluated.modelSha256, input.modelSha256);
    assert.equal(input.targetRating, rating);
  }
});
