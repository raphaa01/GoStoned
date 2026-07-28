import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard, scoreChinese } from "./goEngine";
import {
  ScoreContractError,
  tagChineseAreaScore,
} from "./scoreContract";
import type { ChineseAreaScore } from "./types";

test("tags Black, White, and jigo area scores as immutable breakdown snapshots", () => {
  const blackBoard = createEmptyBoard(9);
  blackBoard[0][0] = "black";
  const cases = [
    [scoreChinese(blackBoard, 0), { kind: "points", winner: "black", margin: 81 }],
    [scoreChinese(createEmptyBoard(9), 6.5), { kind: "points", winner: "white", margin: 6.5 }],
    [scoreChinese(createEmptyBoard(9), 0), { kind: "jigo" }],
  ] as const;

  for (const [score, outcome] of cases) {
    const tagged = tagChineseAreaScore(score, score.white - (
      score.whiteStones + score.whiteTerritory + score.neutralPoints / 2
    ));
    assert.equal(tagged.scoringRule, "chinese-area");
    assert.notEqual(tagged.breakdown, score);
    assert.deepEqual(tagged.breakdown, score);
    assert.deepEqual(tagged.outcome, outcome);
    assert.equal(Object.isFrozen(tagged), true);
    assert.equal(Object.isFrozen(tagged.outcome), true);
    assert.equal(Object.isFrozen(tagged.breakdown), true);
    const originalBlack = tagged.breakdown.black;
    score.black += 1;
    assert.equal(tagged.breakdown.black, originalBlack);
  }
});

test("rejects inconsistent Chinese area arithmetic and result metadata", () => {
  const valid = scoreChinese(createEmptyBoard(9), 7.5);
  const invalid: ChineseAreaScore[] = [
    { ...valid, black: valid.black + 1 },
    { ...valid, white: valid.white + 1 },
    { ...valid, blackStones: -1 },
    { ...valid, whiteTerritory: 0.5 },
    { ...valid, neutralPoints: Number.POSITIVE_INFINITY },
    { ...valid, winner: "black" },
    { ...valid, margin: 0 },
    { ...valid, result: "B+7.5" },
  ];
  for (const score of invalid) {
    assert.throws(() => tagChineseAreaScore(score, 7.5), ScoreContractError);
  }
  assert.throws(() => tagChineseAreaScore(valid, 6.5), ScoreContractError);
  assert.throws(() => tagChineseAreaScore(valid, Number.NaN), ScoreContractError);
});

test("copies only canonical fields in the established score JSON order", () => {
  const valid = scoreChinese(createEmptyBoard(9), 7.5);
  const extended = { ...valid, unexpected: "must not cross the contract" };
  const tagged = tagChineseAreaScore(extended, 7.5);
  assert.equal(
    JSON.stringify(tagged.breakdown),
    "{\"black\":40.5,\"white\":48,\"blackStones\":0,\"whiteStones\":0,\"blackTerritory\":0,\"whiteTerritory\":0,\"neutralPoints\":81,\"winner\":\"white\",\"margin\":7.5,\"result\":\"W+7.5\"}",
  );
  assert.equal("unexpected" in tagged.breakdown, false);
});
