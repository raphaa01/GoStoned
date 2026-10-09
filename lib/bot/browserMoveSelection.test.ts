import assert from "node:assert/strict";
import test from "node:test";
import type { GoStoneBotMove } from "./modelV1";
import {
  BROWSER_BOT_MAXIMUM_POLICY_ODDS,
  browserBotSelectionProfile,
  selectBrowserBotMove,
} from "./browserMoveSelection";

const best: GoStoneBotMove = { kind: "play", x: 0, y: 0 };
const second: GoStoneBotMove = { kind: "play", x: 1, y: 0 };
const third: GoStoneBotMove = { kind: "play", x: 2, y: 0 };
const gap = Math.log(BROWSER_BOT_MAXIMUM_POLICY_ODDS);

test("a decisive policy preference always wins outside the beginner range, including the exact boundary", () => {
  for (const targetRating of [1100, 1200, 1500, 1800, 2100]) {
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
  ], 1200, 0.999999999), second);
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
  for (const [rating, limit] of [[900, 10], [1200, 5], [1500, 3], [1800, 2], [2100, 1]]) {
    assert.deepEqual(selectBrowserBotMove(candidates, rating, 0.999999999), candidates[limit - 1].move);
  }
});

test("Elo temperature still makes close alternatives less likely at higher ratings", () => {
  const candidates = [{ move: best, logit: 0 }, { move: second, logit: -0.5 }];
  assert.deepEqual(selectBrowserBotMove(candidates, 600, 0.5), second);
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
  ], 1200, 0.999999999), pass);
});

test("every rank from 30 through 20 kyu has a progressively stronger selection profile", () => {
  for (let rating = 500; rating < 1100; rating += 50) {
    const weaker = browserBotSelectionProfile(rating);
    const stronger = browserBotSelectionProfile(rating + 50);
    assert.ok(weaker.temperature > stronger.temperature);
    assert.ok(weaker.maximumLogitGap > stronger.maximumLogitGap);
    assert.ok(weaker.oversightProbability > stronger.oversightProbability);
    assert.ok(weaker.candidateLimit >= stronger.candidateLimit);
  }
  for (const boundary of [1000, 1050, 1100]) {
    const before = browserBotSelectionProfile(boundary - 0.001);
    const after = browserBotSelectionProfile(boundary + 0.001);
    assert.ok(Math.abs(before.temperature - after.temperature) < 0.00001);
    assert.ok(Math.abs(before.maximumLogitGap - after.maximumLogitGap) < 0.00001);
    assert.ok(Math.abs(before.oversightProbability - after.oversightProbability) < 0.00001);
  }
});

test("beginner oversights stay model-guided and occur more often toward 30 kyu", () => {
  const candidates = [
    { move: best, logit: 0 },
    { move: second, logit: -2.2 },
    { move: third, logit: -2.5 },
    { move: { kind: "play" as const, x: 3, y: 0 }, logit: -10 },
  ];
  const bestCounts = [500, 750, 1000, 1100].map((rating) => {
    let count = 0;
    for (let sample = 0; sample < 1000; sample += 1) {
      const move = selectBrowserBotMove(candidates, rating, (sample + 0.5) / 1000);
      assert.ok(move === best || move === second || move === third);
      if (move === best) count += 1;
    }
    return count;
  });
  assert.ok(bestCounts[0] < 250, `30 kyu still chooses the top move too often: ${bestCounts}`);
  assert.ok(bestCounts[0] < bestCounts[1] && bestCounts[1] < bestCounts[2]);
  assert.ok(bestCounts[2] < bestCounts[3]);
  assert.equal(bestCounts[3], 1000);
});

test("unsafe beginner alternatives are skipped without suppressing the best tactical move", () => {
  const candidates = [
    { move: best, logit: 0, safeAlternative: false },
    { move: second, logit: -0.1, safeAlternative: false },
    { move: third, logit: -0.2, safeAlternative: true },
  ];
  for (let sample = 0; sample < 100; sample += 1) {
    const move = selectBrowserBotMove(candidates, 500, sample / 100);
    assert.ok(move === best || move === third);
  }
  assert.deepEqual(selectBrowserBotMove(candidates.slice(0, 2), 500, 0.5), best);
});

test("invalid ratings use the default and ratings outside the supported range are bounded", () => {
  assert.deepEqual(browserBotSelectionProfile(NaN), browserBotSelectionProfile(1200));
  assert.deepEqual(browserBotSelectionProfile(-100), browserBotSelectionProfile(500));
  assert.deepEqual(browserBotSelectionProfile(3000), browserBotSelectionProfile(2100));
});
