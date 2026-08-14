import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard } from "@/lib/game/goEngine";
import type { MoveAnalysis } from "./types";
import {
  fixedColorScoreLead,
  fixedColorWinrates,
  formatWinrate,
  moveExplanation,
  normalizeWinrate,
} from "./presentation";

function move(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    moveNumber: 1,
    color: "black",
    playedMove: "E5",
    classification: "mistake",
    winrateBefore: 0.5,
    winrateAfter: 0.4,
    winrateLoss: 0.2,
    scoreLeadBefore: 0,
    scoreLeadAfter: -2.5,
    scoreLoss: 3.5,
    bestMove: "C3",
    alternatives: [{ move: "C3", winrate: 0.6, scoreLead: 1, visits: 100, pv: ["C3", "G7"] }],
    explanation: { de: "alt", en: "old", es: "antigua", fr: "ancienne", ja: "旧", ko: "이전", zh: "旧" },
    ...overrides,
  };
}

test("normalizes probabilities and presents fixed black and white perspectives", () => {
  assert.equal(normalizeWinrate(42), 0.42);
  assert.equal(normalizeWinrate(Number.NaN), 0.5);
  assert.deepEqual(fixedColorWinrates(move()), { black: 0.4, white: 0.6 });
  assert.deepEqual(fixedColorWinrates(move({ color: "white", winrateAfter: 0.7 })), { black: 0.30000000000000004, white: 0.7 });
  assert.equal(formatWinrate(0.999), ">99%");
  assert.equal(formatWinrate(1), ">99%");
  assert.equal(formatWinrate(0.001), "<1%");
  assert.equal(formatWinrate(0), "<1%");
});

test("keeps expected score lead anchored to a fixed color", () => {
  assert.deepEqual(fixedColorScoreLead(move()), { color: "white", points: 2.5 });
  assert.deepEqual(fixedColorScoreLead(move({ color: "white", scoreLeadAfter: 3 })), { color: "white", points: 3 });
});

test("builds a concrete German explanation from the actual board and variation", () => {
  const explanation = moveExplanation(move(), createEmptyBoard(9), 9, "de");
  assert.match(explanation, /C3 gegenüber dem gespielten Zug E5/);
  assert.match(explanation, /20\.0 Prozentpunkte/);
  assert.match(explanation, /Freiheiten/);
  assert.match(explanation, /C3 – G7/);
});
