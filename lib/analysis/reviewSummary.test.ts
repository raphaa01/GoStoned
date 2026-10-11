import assert from "node:assert/strict";
import test from "node:test";
import { reviewPlayerSummary } from "./reviewSummary";
import type { MoveAnalysis } from "./types";

function move(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return { moveNumber: 1, color: "black", playedMove: "C3", classification: "best", winrateBefore: 0.5,
    winrateAfter: 0.5, winrateLoss: 0, scoreLeadBefore: 0, scoreLeadAfter: 0, scoreLoss: 0,
    bestMove: "C3", alternatives: [], explanation: { en: "", de: "", fr: "", es: "", zh: "", ja: "", ko: "" }, ...overrides };
}

test("accuracy and highlights are per player, bounded, and penalize increasing losses", () => {
  const moves = [move({ classification: "brilliant" }), move({ color: "white", classification: "blunder", scoreLoss: 10, winrateLoss: 0.4 })];
  const black = reviewPlayerSummary(moves, "black");
  const white = reviewPlayerSummary(moves, "white");
  assert.equal(black.accuracy, 100);
  assert.equal(black.counts.brilliant, 1);
  assert.equal(black.counts.blunder, 0);
  assert.equal(white.counts.blunder, 1);
  assert.ok(white.accuracy !== null && white.accuracy < 20 && white.accuracy >= 0);
  const smallerLoss = reviewPlayerSummary([move({ scoreLoss: 2 })], "black");
  assert.ok(smallerLoss.accuracy !== null && smallerLoss.accuracy > white.accuracy);
});

test("missing evaluations do not invent accuracy or classifications and previews stay preliminary", () => {
  const missing = reviewPlayerSummary([move({ classification: null, scoreLoss: null, winrateLoss: null })], "black");
  assert.equal(missing.accuracy, null);
  assert.equal(missing.preliminary, true);
  assert.equal(Object.values(missing.counts).reduce((sum, count) => sum + count, 0), 0);
  assert.equal(reviewPlayerSummary([move({ provisional: true })], "black").preliminary, true);
  assert.equal(reviewPlayerSummary([], "white").accuracy, null);
  assert.equal(reviewPlayerSummary([move({ scoreLoss: NaN })], "black").evaluatedMoves, 0);
});
