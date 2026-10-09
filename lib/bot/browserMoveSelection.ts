import type { GoStoneBotMove } from "./modelV1";

export type BrowserBotCandidate = Readonly<{
  move: GoStoneBotMove;
  logit: number;
  safeAlternative?: boolean;
}>;

// Policy odds, not territory points: exp(bestLogit - candidateLogit).
export const BROWSER_BOT_MAXIMUM_POLICY_ODDS = 8;
const maximumLogitGap = Math.log(BROWSER_BOT_MAXIMUM_POLICY_ODDS);

export function browserBotSelectionProfile(targetRating: number) {
  const rating = Math.max(500, Math.min(2_100, Number.isFinite(targetRating) ? targetRating : 1_200));
  // 30 kyu = 500, 25 kyu = 750, 20 kyu = 1000. Fade out by 18 kyu,
  // so crossing 20 kyu never abruptly restores the old playing strength.
  const beginner = Math.max(0, Math.min(1, (1_100 - rating) / 600));
  const candidateLimit = rating >= 2_000 ? 1 : rating >= 1_700 ? 2
    : rating >= 1_400 ? 3 : rating >= 1_100 ? 5 : Math.round(5 + 19 * beginner);
  const temperature = rating >= 2_000 ? 0.08 : rating >= 1_100
    ? Math.max(0.2, 1.65 - (rating - 600) / 1_050) : 1.65 - 500 / 1_050 + 1.7 * beginner;
  return {
    candidateLimit,
    temperature,
    maximumLogitGap: maximumLogitGap + Math.log(8) * beginner,
    oversightProbability: 0.7 * beginner,
  };
}

export function selectBrowserBotMove(
  candidates: readonly BrowserBotCandidate[],
  targetRating: number,
  randomUnit: number,
): GoStoneBotMove {
  if (candidates.length === 0) return { kind: "pass" };
  const ordered = [...candidates].sort((left, right) => right.logit - left.logit);
  const profile = browserBotSelectionProfile(targetRating);
  const maximum = ordered[0].logit;
  let pool = ordered.filter(({ logit, safeAlternative }, index) => index === 0
    || (safeAlternative !== false && maximum - logit < profile.maximumLogitGap))
    .slice(0, profile.candidateLimit);
  if (pool.length === 1) return pool[0].move;

  let unit = Math.max(0, Math.min(0.999999999, randomUnit));
  // Occasional missed priorities, increasingly common toward 30 kyu. Alternatives
  // still come from the model's bounded policy pool, never arbitrary board points.
  if (unit < profile.oversightProbability) {
    pool = pool.slice(1);
    unit /= profile.oversightProbability;
  } else {
    unit = (unit - profile.oversightProbability) / (1 - profile.oversightProbability);
  }
  const weights = pool.map(({ logit }) => Math.exp((logit - maximum) / profile.temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = unit * total;
  for (let index = 0; index < pool.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return pool[index].move;
  }
  return pool.at(-1)!.move;
}
