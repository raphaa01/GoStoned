import type { GoStoneBotMove } from "./modelV1";

type BrowserBotCandidate = Readonly<{ move: GoStoneBotMove; logit: number }>;

// Policy odds, not territory points: exp(bestLogit - candidateLogit).
export const BROWSER_BOT_MAXIMUM_POLICY_ODDS = 8;
const maximumLogitGap = Math.log(BROWSER_BOT_MAXIMUM_POLICY_ODDS);

export function selectBrowserBotMove(
  candidates: readonly BrowserBotCandidate[],
  targetRating: number,
  randomUnit: number,
): GoStoneBotMove {
  if (candidates.length === 0) return { kind: "pass" };
  const ordered = [...candidates].sort((left, right) => right.logit - left.logit);
  const rating = Math.max(600, Math.min(2_100, targetRating));
  const candidateLimit = rating >= 2_000 ? 1 : rating >= 1_700 ? 2
    : rating >= 1_400 ? 3 : rating >= 1_100 ? 5 : rating >= 800 ? 7 : 10;
  const temperature = rating >= 2_000 ? 0.08 : Math.max(0.2, 1.65 - (rating - 600) / 1_050);
  const maximum = ordered[0].logit;
  // Apply the gap before Elo temperature can flatten a decisive model preference.
  // If even the runner-up falls outside the gap, only the best move remains.
  const pool = ordered.slice(0, candidateLimit)
    .filter(({ logit }, index) => index === 0 || maximum - logit < maximumLogitGap);
  if (pool.length === 1) return pool[0].move;

  const weights = pool.map(({ logit }) => Math.exp((logit - maximum) / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = Math.max(0, Math.min(0.999999999, randomUnit)) * total;
  for (let index = 0; index < pool.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return pool[index].move;
  }
  return pool.at(-1)!.move;
}
