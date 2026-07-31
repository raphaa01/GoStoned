import type { KataGoMoveInfo } from "@/lib/analysis/types";

export type BotDifficulty = Readonly<{
  targetRating: number;
  visitsPerTurn: number;
  candidateLimit: number;
  temperature: number;
  minimumThinkMs: number;
  maximumThinkMs: number;
}>;

export const BOT_MINIMUM_THINK_MS = 3_000;
export const BOT_MAXIMUM_THINK_MS = 9_000;

export function botDifficultyForRating(rawRating: number): BotDifficulty {
  const targetRating = Math.max(100, Math.min(3000, Math.round(rawRating || 1200)));
  const visitsPerTurn = Math.max(
    8,
    Math.min(800, Math.round(8 * 2 ** ((targetRating - 600) / 350))),
  );
  const candidateLimit = targetRating >= 2100
    ? 1
    : targetRating >= 1750
      ? 2
      : targetRating >= 1450
        ? 3
        : targetRating >= 1150
          ? 4
          : targetRating >= 850
            ? 6
            : 8;
  const temperature = targetRating >= 2100
    ? 0.08
    : Math.max(0.22, Math.min(1.8, 1.8 - (targetRating - 400) / 1_250));
  const minimumThinkMs = BOT_MINIMUM_THINK_MS;
  const maximumThinkMs = BOT_MAXIMUM_THINK_MS;
  return {
    targetRating,
    visitsPerTurn,
    candidateLimit,
    temperature,
    minimumThinkMs,
    maximumThinkMs,
  };
}

export function selectBotThinkDelayMs(
  difficulty: Pick<BotDifficulty, "minimumThinkMs" | "maximumThinkMs">,
  randomUnit: number,
): number {
  const unit = Math.max(0, Math.min(1, randomUnit));
  return Math.round(
    difficulty.minimumThinkMs
      + unit * (difficulty.maximumThinkMs - difficulty.minimumThinkMs),
  );
}

export function selectBotMove(
  moveInfos: readonly KataGoMoveInfo[],
  difficulty: Pick<BotDifficulty, "candidateLimit" | "temperature">,
  randomUnit: number,
  options: { moveNumber: number; boardSize: number },
): KataGoMoveInfo {
  const ordered = [...moveInfos]
    .filter((move) => typeof move.move === "string" && move.move.length > 0)
    .sort((left, right) => left.order - right.order || right.visits - left.visits);
  if (ordered.length === 0) throw new Error("KataGo returned no playable candidates.");

  const avoidEarlyPass = options.moveNumber < Math.floor(options.boardSize * options.boardSize * 0.28);
  const withoutEarlyPass = avoidEarlyPass
    ? ordered.filter((move) => move.move.toLowerCase() !== "pass")
    : ordered;
  const pool = (withoutEarlyPass.length > 0 ? withoutEarlyPass : ordered)
    .slice(0, Math.max(1, difficulty.candidateLimit));
  if (pool.length === 1) return pool[0];

  const temperature = Math.max(0.05, difficulty.temperature);
  const weights = pool.map((move, index) => {
    const visitWeight = Math.max(1, move.visits) ** (1 / Math.max(0.4, temperature));
    const rankWeight = Math.exp(-index / temperature);
    return visitWeight * rankWeight;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = Math.max(0, Math.min(0.999999999, randomUnit)) * total;
  for (let index = 0; index < pool.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return pool[index];
  }
  return pool[pool.length - 1];
}
