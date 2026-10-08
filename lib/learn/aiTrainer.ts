import { fromGtpCoordinate, toGtpCoordinate } from "@/lib/analysis/coordinates";
import { ANALYSIS_ENGINE_CONTRACT_VERSION, type AnalysisInput, type KataGoTurnResult } from "@/lib/analysis/types";
import type { GoStoneBotMove } from "@/lib/bot/modelV1";
import { applyTrainingAction, createTrainingPosition, type TrainingPosition } from "./trainingGame";

export const TRAINER_KOMI = 6.5;
export type TrainerPositionAnalysis = KataGoTurnResult & { ownership?: number[] };
export type TrainerStrength = Readonly<{ rating: number; visits: number; temperature: number; maximumScoreLoss: number }>;

// An approximate practice profile, not a calibrated or rated KataGo identity.
export function trainerStrength(playerRating: number | null | undefined): TrainerStrength {
  const rating = Math.max(400, Math.min(3000, Number.isFinite(playerRating) ? playerRating! : 1200));
  const strength = (rating - 400) / 2600;
  return { rating, visits: Math.round(16 + strength * 64), temperature: 2.4 * (1 - strength), maximumScoreLoss: 8 * (1 - strength) };
}

export function trainerAnalysisInput(position: TrainingPosition, gameId: string, revision: number): AnalysisInput {
  return {
    contractVersion: ANALYSIS_ENGINE_CONTRACT_VERSION,
    gameId,
    gameVersion: revision,
    boardSize: position.boardSize,
    rules: "japanese",
    komi: TRAINER_KOMI,
    moves: position.moves.map((move) => ({ color: move.color, move: toGtpCoordinate(position.boardSize, move) })),
  };
}

function legalCandidates(position: TrainingPosition, analysis: TrainerPositionAnalysis) {
  const expectedPlayer = position.turn === "black" ? "B" : "W";
  if (analysis.turnNumber !== position.moves.length || analysis.rootInfo.currentPlayer !== expectedPlayer) {
    throw new Error("The KataGo result belongs to a different position.");
  }
  return [...analysis.moveInfos].sort((a, b) => a.order - b.order).flatMap((candidate) => {
    try {
      const coordinate = fromGtpCoordinate(position.boardSize, candidate.move);
      const action: GoStoneBotMove = coordinate.isPass ? { kind: "pass" } : { kind: "play", x: coordinate.x!, y: coordinate.y! };
      return candidate.visits >= 1 && applyTrainingAction(position, action).ok ? [{ candidate, action }] : [];
    } catch {
      return [];
    }
  });
}

export function trainerBestMove(position: TrainingPosition, analysis: TrainerPositionAnalysis): GoStoneBotMove {
  const best = legalCandidates(position, analysis)[0];
  if (!best) throw new Error("KataGo did not return a searched legal move.");
  return best.action;
}

export function trainerOpponentMove(
  position: TrainingPosition,
  analysis: TrainerPositionAnalysis,
  profile: TrainerStrength,
  random = Math.random,
): GoStoneBotMove {
  const candidates = legalCandidates(position, analysis);
  const best = candidates[0];
  if (!best) throw new Error("KataGo did not return a searched legal move.");
  // Never manufacture an early pass to weaken the opponent.
  if (best.action.kind === "pass" || profile.temperature < 0.05) return best.action;
  const pool = candidates.filter(({ action, candidate }) => action.kind !== "pass"
    && (candidate === best.candidate || candidate.visits >= 2)
    && best.candidate.scoreLead - candidate.scoreLead <= profile.maximumScoreLoss);
  const weighted = pool.map((entry) => ({
    ...entry,
    weight: Math.exp(-Math.max(0, best.candidate.scoreLead - entry.candidate.scoreLead) / Math.max(0.05, profile.temperature)),
  }));
  let pick = Math.max(0, Math.min(1, random())) * weighted.reduce((sum, entry) => sum + entry.weight, 0);
  for (const entry of weighted) {
    pick -= entry.weight;
    if (pick <= 0) return entry.action;
  }
  return best.action;
}

// Remove the last human move AND its reply; replay restores captures, ko and passes.
export function undoTrainerTurn(position: TrainingPosition): TrainingPosition {
  const lastHumanMove = position.moves.findLastIndex((move) => move.color === "black");
  if (lastHumanMove < 0) return position;
  let restored = createTrainingPosition(position.boardSize);
  for (const move of position.moves.slice(0, lastHumanMove)) {
    const action: GoStoneBotMove = move.isPass ? { kind: "pass" } : { kind: "play", x: move.x!, y: move.y! };
    const result = applyTrainingAction(restored, action, move.createdAt);
    if (!result.ok) throw new Error("The training move history cannot be restored.");
    restored = result.position;
  }
  return restored;
}

export function trainerBlackLead(analysis: TrainerPositionAnalysis): number {
  return analysis.rootInfo.currentPlayer === "B" ? analysis.rootInfo.scoreLead : -analysis.rootInfo.scoreLead;
}
