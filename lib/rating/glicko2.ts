export const GLICKO2_ALGORITHM_VERSION = "glicko2-v1-tau-0.5" as const;
export const GLICKO2_SCALE = 173.7178;
export const GLICKO2_DEFAULT_TAU = 0.5;
export const GLICKO2_DEFAULT_CONVERGENCE_TOLERANCE = 0.000001;

export type Glicko2Rating = Readonly<{
  rating: number;
  ratingDeviation: number;
  volatility: number;
}>;

export type Glicko2Result = Readonly<{
  opponentRating: number;
  opponentRatingDeviation: number;
  score: 0 | 0.5 | 1;
}>;

export type Glicko2Options = Readonly<{
  convergenceTolerance?: number;
  tau?: number;
}>;

type ScaledResult = Readonly<{
  expectedScore: number;
  impact: number;
  score: Glicko2Result["score"];
}>;

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}

function validateRating(rating: Glicko2Rating): void {
  requireFinite(rating.rating, "Rating");
  requireFinite(rating.ratingDeviation, "Rating deviation");
  requireFinite(rating.volatility, "Volatility");
  if (rating.ratingDeviation <= 0) {
    throw new RangeError("Rating deviation must be greater than zero.");
  }
  if (rating.volatility <= 0) {
    throw new RangeError("Volatility must be greater than zero.");
  }
}

function validateOptions(options: Glicko2Options): Required<Glicko2Options> {
  const tau = options.tau ?? GLICKO2_DEFAULT_TAU;
  const convergenceTolerance = options.convergenceTolerance
    ?? GLICKO2_DEFAULT_CONVERGENCE_TOLERANCE;
  requireFinite(tau, "Tau");
  requireFinite(convergenceTolerance, "Convergence tolerance");
  if (tau <= 0) throw new RangeError("Tau must be greater than zero.");
  if (convergenceTolerance <= 0) {
    throw new RangeError("Convergence tolerance must be greater than zero.");
  }
  return { convergenceTolerance, tau };
}

function scaleRating(rating: number): number {
  return (rating - 1500) / GLICKO2_SCALE;
}

function scaleDeviation(ratingDeviation: number): number {
  return ratingDeviation / GLICKO2_SCALE;
}

function ratingImpact(opponentDeviation: number): number {
  return 1 / Math.sqrt(1 + (3 * opponentDeviation ** 2) / Math.PI ** 2);
}

function expectedScore(
  playerRating: number,
  opponentRating: number,
  impact: number,
): number {
  return 1 / (1 + Math.exp(-impact * (playerRating - opponentRating)));
}

function scaleResult(playerRating: number, result: Glicko2Result): ScaledResult {
  requireFinite(result.opponentRating, "Opponent rating");
  requireFinite(result.opponentRatingDeviation, "Opponent rating deviation");
  if (result.opponentRatingDeviation <= 0) {
    throw new RangeError("Opponent rating deviation must be greater than zero.");
  }
  if (result.score !== 0 && result.score !== 0.5 && result.score !== 1) {
    throw new RangeError("Score must be 0, 0.5, or 1.");
  }

  const opponentRating = scaleRating(result.opponentRating);
  const opponentDeviation = scaleDeviation(result.opponentRatingDeviation);
  const impact = ratingImpact(opponentDeviation);
  return {
    expectedScore: expectedScore(playerRating, opponentRating, impact),
    impact,
    score: result.score,
  };
}

function determineVolatility(
  deviation: number,
  volatility: number,
  variance: number,
  improvement: number,
  tau: number,
  convergenceTolerance: number,
): number {
  const deviationSquared = deviation ** 2;
  const improvementSquared = improvement ** 2;
  const initial = Math.log(volatility ** 2);
  const objective = (value: number) => {
    const exponential = Math.exp(value);
    const denominator = deviationSquared + variance + exponential;
    return (
      (exponential * (improvementSquared - deviationSquared - variance - exponential))
      / (2 * denominator ** 2)
      - (value - initial) / tau ** 2
    );
  };

  let lower = initial;
  let upper: number;
  if (improvementSquared > deviationSquared + variance) {
    upper = Math.log(improvementSquared - deviationSquared - variance);
  } else {
    let step = 1;
    upper = initial - step * tau;
    while (objective(upper) < 0) {
      step += 1;
      upper = initial - step * tau;
      if (step > 10_000) {
        throw new Error("Glicko-2 volatility bracketing did not converge.");
      }
    }
  }

  let lowerValue = objective(lower);
  let upperValue = objective(upper);
  let iterations = 0;
  while (Math.abs(upper - lower) > convergenceTolerance) {
    const candidate = lower
      + ((lower - upper) * lowerValue) / (upperValue - lowerValue);
    const candidateValue = objective(candidate);
    if (candidateValue * upperValue <= 0) {
      lower = upper;
      lowerValue = upperValue;
    } else {
      lowerValue /= 2;
    }
    upper = candidate;
    upperValue = candidateValue;
    iterations += 1;
    if (iterations > 10_000) {
      throw new Error("Glicko-2 volatility iteration did not converge.");
    }
  }

  return Math.exp(lower / 2);
}

/**
 * Applies one Glicko-2 rating period using Mark Glickman's published algorithm.
 * Results in the same rating period are evaluated against the same pre-period
 * player state. An empty result list applies the published inactivity step.
 *
 * @see https://www.glicko.net/glicko/glicko2.pdf
 */
export function updateGlicko2Rating(
  player: Glicko2Rating,
  results: readonly Glicko2Result[],
  options: Glicko2Options = {},
): Glicko2Rating {
  validateRating(player);
  if (!Array.isArray(results)) throw new TypeError("Results must be an array.");
  const { convergenceTolerance, tau } = validateOptions(options);
  const playerRating = scaleRating(player.rating);
  const playerDeviation = scaleDeviation(player.ratingDeviation);

  if (results.length === 0) {
    return Object.freeze({
      rating: player.rating,
      ratingDeviation: Math.sqrt(playerDeviation ** 2 + player.volatility ** 2)
        * GLICKO2_SCALE,
      volatility: player.volatility,
    });
  }

  const scaledResults = results.map((result) => scaleResult(playerRating, result));
  const information = scaledResults.reduce(
    (sum, result) => sum
      + result.impact ** 2
      * result.expectedScore
      * (1 - result.expectedScore),
    0,
  );
  if (!Number.isFinite(information) || information <= 0) {
    throw new RangeError("Results do not produce finite Glicko-2 information.");
  }
  const variance = 1 / information;
  const scoreDifference = scaledResults.reduce(
    (sum, result) => sum
      + result.impact * (result.score - result.expectedScore),
    0,
  );
  const improvement = variance * scoreDifference;
  const volatility = determineVolatility(
    playerDeviation,
    player.volatility,
    variance,
    improvement,
    tau,
    convergenceTolerance,
  );
  const prePeriodDeviation = Math.sqrt(playerDeviation ** 2 + volatility ** 2);
  const ratingDeviation = 1 / Math.sqrt(
    1 / prePeriodDeviation ** 2 + 1 / variance,
  );
  const rating = playerRating + ratingDeviation ** 2 * scoreDifference;

  return Object.freeze({
    rating: rating * GLICKO2_SCALE + 1500,
    ratingDeviation: ratingDeviation * GLICKO2_SCALE,
    volatility,
  });
}
