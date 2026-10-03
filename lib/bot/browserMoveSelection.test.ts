import assert from "node:assert/strict";
import test from "node:test";
import type { GoStoneBotMove } from "./modelV1";
import {
  BROWSER_BOT_MAXIMUM_POLICY_ODDS,
  selectBrowserBotMove,
} from "./browserMoveSelection";

const best: GoStoneBotMove = { kind: "play", x: 0, y: 0 };
const second: GoStoneBotMove = { kind: "play", x: 1, y: 0 };
const third: GoStoneBotMove = { kind: "play", x: 2, y: 0 };
const gap = Math.log(BROWSER_BOT_MAXIMUM_POLICY_ODDS);

test("a decisive policy preference always wins at every Elo, including the exact boundary", () => {
  for (const targetRating of [600, 900, 1200, 1500, 1800, 2100]) {
    for (const randomUnit of [0, 0.5, 0.999999999]) {
      for (const bestLogit of [gap, gap + 1]) {
        assert.deepEqual(selectBrowserBotMove([
          { move: second, logit: 0 },
          { move: third, logit: -1 },
          { move: best, logit: bestLogit },
        ], targetRating, randomUnit), best);
      }
    }
  }
});

test("a preference just below the boundary still allows an alternative", () => {
  assert.deepEqual(selectBrowserBotMove([
    { move: best, logit: gap - 0.000001 },
    { move: second, logit: 0 },
  ], 600, 0.999999999), second);
});

test("close alternatives stay available while a much weaker third move is excluded", () => {
  const candidates = [
    { move: best, logit: 0 },
    { move: second, logit: -0.1 },
    { move: third, logit: -gap - 1 },
  ];
  assert.deepEqual(selectBrowserBotMove(candidates, 1200, 0), best);
  assert.deepEqual(selectBrowserBotMove(candidates, 1200, 0.999999999), second);
});

test("equal policy evaluations retain Elo-dependent candidate limits", () => {
  const candidates = Array.from({ length: 10 }, (_, x) => ({
    move: { kind: "play" as const, x, y: 0 }, logit: 0,
  }));
  for (const [rating, limit] of [[600, 10], [900, 7], [1200, 5], [1500, 3], [1800, 2], [2100, 1]]) {
    assert.deepEqual(selectBrowserBotMove(candidates, rating, 0.999999999), candidates[limit - 1].move);
  }
});

test("Elo temperature still makes close alternatives less likely at higher ratings", () => {
  const candidates = [{ move: best, logit: 0 }, { move: second, logit: -0.5 }];
  assert.deepEqual(selectBrowserBotMove(candidates, 600, 0.7), second);
  assert.deepEqual(selectBrowserBotMove(candidates, 1800, 0.7), best);
});

test("selection is repeatable, ignores common logit offsets, and leaves candidates untouched", () => {
  const candidates = Object.freeze([
    Object.freeze({ move: third, logit: -4 }),
    Object.freeze({ move: second, logit: -0.5 }),
    Object.freeze({ move: best, logit: 0 }),
  ]);
  const expected = selectBrowserBotMove(candidates, 1200, 0.9);
  assert.deepEqual(selectBrowserBotMove(candidates, 1200, 0.9), expected);
  assert.deepEqual(selectBrowserBotMove(candidates.map((candidate) => ({
    ...candidate, logit: candidate.logit + 100,
  })), 1200, 0.9), expected);
});

test("passing remains supported for an empty pool or a strong legal pass candidate", () => {
  const pass: GoStoneBotMove = { kind: "pass" };
  assert.deepEqual(selectBrowserBotMove([], 1200, 0.9), pass);
  assert.deepEqual(selectBrowserBotMove([{ move: best, logit: -100 }], 1200, 0.9), best);
  assert.deepEqual(selectBrowserBotMove([
    { move: pass, logit: gap }, { move: best, logit: 0 },
  ], 600, 0.999999999), pass);
});
