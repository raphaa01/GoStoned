import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard } from "@/lib/game/goEngine";
import type { MoveAnalysis } from "./types";
import {
  fixedColorScoreLead,
  fixedColorWinrates,
  formatWinrate,
  moveExplanation,
  meaningfulMoveComment,
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

test("builds a short concrete German explanation without repeating score metrics", () => {
  const explanation = moveExplanation(move(), createEmptyBoard(9), 9, "de");
  assert.match(explanation, /KataGo empfiehlt C3/);
  assert.match(explanation, /Freiheiten/);
  assert.doesNotMatch(explanation, /Prozentpunkte|Punkte mehr|C3 – G7/);
});

test("builds a Kyrgyz board explanation for newly localized reviews", () => {
  const explanation = moveExplanation(move(), createEmptyBoard(9), 9, "ky");
  assert.match(explanation, /KataGo C3 жүрүшүн сунуштайт/);
  assert.doesNotMatch(explanation, /20\.0|3\.5/);
});

test("root-only previews never claim that an unsearched move is KataGo's recommendation", () => {
  const preview = move({ bestMove: null, classification: null, alternatives: [], winrateLoss: null, scoreLoss: null });
  assert.equal(moveExplanation(preview, createEmptyBoard(9), 9, "de"), preview.explanation.de);
  assert.equal(moveExplanation(preview, createEmptyBoard(9), 9, "en"), preview.explanation.en);
});

test("review comments omit generic preferences, root-only filler and passing", () => {
  const board = createEmptyBoard(9);
  assert.equal(meaningfulMoveComment(move(), board, 9, "de"), null);
  assert.equal(meaningfulMoveComment(move({ bestMove: null }), board, 9, "de"), null);
  assert.equal(meaningfulMoveComment(move({ playedMove: "pass" }), board, 9, "de"), null);
});

test("review comments explain observable captures and atari without numeric evaluation filler", () => {
  const board = createEmptyBoard(9);
  board[1][1] = "white";
  board[0][1] = board[1][0] = board[1][2] = "black";
  const capture = meaningfulMoveComment(move({ playedMove: "B7" }), board, 9, "de");
  assert.match(capture!, /schlägt einen Stein/);
  assert.doesNotMatch(capture!, /KataGo|Punkt|Prozent/);
  board[1][1] = null;
  board[0][1] = board[1][0] = board[1][2] = "white";
  assert.match(meaningfulMoveComment(move({ playedMove: "B8" }), board, 9, "de")!, /Atari/);
});

test("alternating mover perspectives keep the same fixed black win chance and score lead", () => {
  const black = move({ winrateAfter: 0.99, scoreLeadAfter: 20 });
  const white = move({ color: "white", winrateAfter: 0.01, scoreLeadAfter: -20 });
  assert.ok(Math.abs(fixedColorWinrates(black).black - fixedColorWinrates(white).black) < 1e-12);
  assert.deepEqual(fixedColorScoreLead(black), fixedColorScoreLead(white));
});
