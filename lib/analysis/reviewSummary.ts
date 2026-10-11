import type { MoveAnalysis, MoveClassification } from "./types";

export const REVIEW_CLASSIFICATIONS: readonly MoveClassification[] = [
  "brilliant", "great", "best", "excellent", "good", "inaccuracy", "mistake", "blunder",
];

export function reviewPlayerSummary(moves: readonly MoveAnalysis[], color: "black" | "white") {
  const counts = Object.fromEntries(REVIEW_CLASSIFICATIONS.map((label) => [label, 0])) as Record<MoveClassification, number>;
  let totalAccuracy = 0;
  let evaluatedMoves = 0;
  const playerMoves = moves.filter((move) => move.color === color);
  for (const move of playerMoves) {
    if (move.classification) counts[move.classification] += 1;
    if (move.scoreLoss === null || move.winrateLoss === null
      || !Number.isFinite(move.scoreLoss) || !Number.isFinite(move.winrateLoss)) continue;
    totalAccuracy += 100 * Math.exp(-Math.max(Math.max(0, move.scoreLoss) / 6, Math.max(0, move.winrateLoss) * 4));
    evaluatedMoves += 1;
  }
  return { counts, accuracy: evaluatedMoves ? totalAccuracy / evaluatedMoves : null, evaluatedMoves,
    preliminary: playerMoves.some((move) => move.provisional || move.classification === null) };
}
