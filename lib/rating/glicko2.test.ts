import assert from "node:assert/strict";
import test from "node:test";
import {
  GLICKO2_ALGORITHM_VERSION,
  GLICKO2_SCALE,
  updateGlicko2Rating,
  type Glicko2Result,
} from "./glicko2";

function closeTo(actual: number, expected: number, tolerance: number): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}.`,
  );
}

const publishedPlayer = {
  rating: 1500,
  ratingDeviation: 200,
  volatility: 0.06,
} as const;

const publishedResults: readonly Glicko2Result[] = [
  { opponentRating: 1400, opponentRatingDeviation: 30, score: 1 },
  { opponentRating: 1550, opponentRatingDeviation: 100, score: 0 },
  { opponentRating: 1700, opponentRatingDeviation: 300, score: 0 },
];

test("matches the published Glicko-2 example", () => {
  const updated = updateGlicko2Rating(publishedPlayer, publishedResults, { tau: 0.5 });

  closeTo(updated.rating, 1464.06, 0.02);
  closeTo(updated.ratingDeviation, 151.52, 0.02);
  closeTo(updated.volatility, 0.05999, 0.00001);
  assert.equal(GLICKO2_SCALE, 173.7178);
  assert.equal(GLICKO2_ALGORITHM_VERSION, "glicko2-v1-tau-0.5");
});

test("a rating period is independent of opponent input order", () => {
  const forward = updateGlicko2Rating(publishedPlayer, publishedResults);
  const reverse = updateGlicko2Rating(publishedPlayer, [...publishedResults].reverse());

  closeTo(forward.rating, reverse.rating, 1e-10);
  closeTo(forward.ratingDeviation, reverse.ratingDeviation, 1e-10);
  closeTo(forward.volatility, reverse.volatility, 1e-12);
});

test("an equal-rating draw preserves rating while reducing uncertainty", () => {
  const updated = updateGlicko2Rating(publishedPlayer, [{
    opponentRating: 1500,
    opponentRatingDeviation: 200,
    score: 0.5,
  }]);

  closeTo(updated.rating, 1500, 1e-10);
  assert.ok(updated.ratingDeviation < publishedPlayer.ratingDeviation);
  assert.ok(updated.volatility > 0);
});

test("an empty rating period applies only inactivity deviation", () => {
  const updated = updateGlicko2Rating(publishedPlayer, []);
  const expectedDeviation = Math.sqrt(
    (publishedPlayer.ratingDeviation / GLICKO2_SCALE) ** 2
    + publishedPlayer.volatility ** 2,
  ) * GLICKO2_SCALE;

  assert.equal(updated.rating, publishedPlayer.rating);
  closeTo(updated.ratingDeviation, expectedDeviation, 1e-12);
  assert.equal(updated.volatility, publishedPlayer.volatility);
});

test("an upset moves rating farther than an expected result", () => {
  const expectedWin = updateGlicko2Rating(publishedPlayer, [{
    opponentRating: 1300,
    opponentRatingDeviation: 80,
    score: 1,
  }]);
  const upsetWin = updateGlicko2Rating(publishedPlayer, [{
    opponentRating: 1700,
    opponentRatingDeviation: 80,
    score: 1,
  }]);

  assert.ok(upsetWin.rating - publishedPlayer.rating > expectedWin.rating - publishedPlayer.rating);
});

test("rejects malformed rating states, results, and algorithm options", () => {
  assert.throws(
    () => updateGlicko2Rating({ ...publishedPlayer, ratingDeviation: 0 }, []),
    /Rating deviation must be greater than zero/,
  );
  assert.throws(
    () => updateGlicko2Rating({ ...publishedPlayer, volatility: Number.NaN }, []),
    /Volatility must be finite/,
  );
  assert.throws(
    () => updateGlicko2Rating(publishedPlayer, [{
      opponentRating: 1400,
      opponentRatingDeviation: -1,
      score: 1,
    }]),
    /Opponent rating deviation must be greater than zero/,
  );
  assert.throws(
    () => updateGlicko2Rating(publishedPlayer, [{
      opponentRating: 1400,
      opponentRatingDeviation: 30,
      score: 0.25 as 0,
    }]),
    /Score must be 0, 0.5, or 1/,
  );
  assert.throws(
    () => updateGlicko2Rating(publishedPlayer, publishedResults, { tau: 0 }),
    /Tau must be greater than zero/,
  );
});
