import { coordinateRegion } from "./coordinates";
import {
  ANALYSIS_ENGINE_CONTRACT_VERSION,
  type AnalysisInput,
  type GameAnalysisResult,
  type KataGoTurnResult,
  type MoveAnalysis,
  type MoveClassification,
} from "./types";

export function classifyMove(winrateLoss: number, bestMove: boolean, uniqueness: number): MoveClassification {
  if (bestMove && winrateLoss <= 0.01 && uniqueness >= 0.08) return "brilliant";
  if (bestMove && winrateLoss <= 0.012) return "best";
  if (winrateLoss <= 0.015) return "great";
  if (winrateLoss <= 0.03) return "excellent";
  if (winrateLoss <= 0.06) return "good";
  if (winrateLoss <= 0.12) return "inaccuracy";
  if (winrateLoss <= 0.22) return "mistake";
  return "blunder";
}

function moverPerspective(value: number, resultPlayer: "B" | "W", mover: "black" | "white") {
  return resultPlayer === (mover === "black" ? "B" : "W") ? value : 1 - value;
}

function moverScore(value: number, resultPlayer: "B" | "W", mover: "black" | "white") {
  return resultPlayer === (mover === "black" ? "B" : "W") ? value : -value;
}

function signedPoints(value: number) {
  return `${Math.abs(value).toFixed(1)} points`;
}

function explanations(
  input: AnalysisInput,
  playedMove: string,
  bestMove: string,
  winrateLoss: number,
  scoreLoss: number,
  pv: string[],
) {
  const region = coordinateRegion(bestMove, input.boardSize);
  const enRegion = region === "corner" ? "secures the corner efficiently"
    : region === "side" ? "builds from the side while staying connected"
      : region === "center" ? "keeps influence and initiative in the center"
        : "avoids an unnecessary local commitment";
  const deRegion = region === "corner" ? "sichert die Ecke effizient"
    : region === "side" ? "baut vom Rand aus auf und bleibt verbunden"
      : region === "center" ? "behält Einfluss und Initiative im Zentrum"
        : "vermeidet eine unnötige lokale Festlegung";
  const sequenceEn = pv.length > 1 ? ` The expected continuation starts ${pv.slice(0, 4).join(" – ")}.` : "";
  const sequenceDe = pv.length > 1 ? ` Die erwartete Fortsetzung beginnt mit ${pv.slice(0, 4).join(" – ")}.` : "";
  if (playedMove === bestMove) {
    return {
      en: `${bestMove} is KataGo's first choice. It ${enRegion} and preserves the position's winning chances.${sequenceEn}`,
      de: `${bestMove} ist KataGos erste Wahl. Der Zug ${deRegion} und erhält die Gewinnchancen der Stellung.${sequenceDe}`,
    };
  }
  const lossText = `${(winrateLoss * 100).toFixed(1)} percentage points`;
  const scoreText = signedPoints(scoreLoss);
  return {
    en: `${bestMove} is stronger than ${playedMove}: it ${enRegion}. KataGo estimates about ${lossText} more winning chance and ${scoreText} more score for the player to move.${sequenceEn}`,
    de: `${bestMove} ist stärker als ${playedMove}: Der Zug ${deRegion}. KataGo schätzt etwa ${(winrateLoss * 100).toFixed(1)} Prozentpunkte mehr Gewinnchance und ${Math.abs(scoreLoss).toFixed(1)} Punkte mehr Ergebnis für den Spieler am Zug.${sequenceDe}`,
  };
}

function emptySummary(): Record<MoveClassification, number> {
  return { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
}

export function buildGameAnalysis(
  input: AnalysisInput,
  turns: KataGoTurnResult[],
  engine: { version: string; model: string; visitsPerTurn: number },
  analyzedAt = new Date().toISOString(),
): GameAnalysisResult {
  const byTurn = new Map(turns.map((turn) => [turn.turnNumber, turn]));
  const analyses: MoveAnalysis[] = input.moves.map((played, index) => {
    const before = byTurn.get(index);
    const after = byTurn.get(index + 1);
    if (!before || !after || before.moveInfos.length === 0) {
      throw new Error(`KataGo did not return a complete result for move ${index + 1}.`);
    }
    const ranked = [...before.moveInfos].sort((a, b) => a.order - b.order);
    const best = ranked[0];
    const second = ranked[1];
    const actualWinrate = moverPerspective(after.rootInfo.winrate, after.rootInfo.currentPlayer, played.color);
    const actualScore = moverScore(after.rootInfo.scoreLead, after.rootInfo.currentPlayer, played.color);
    const loss = Math.max(0, best.winrate - actualWinrate);
    const scoreLoss = Math.max(0, best.scoreLead - actualScore);
    const uniqueness = second ? Math.max(0, best.winrate - second.winrate) : 0;
    const classification = classifyMove(loss, best.move.toLowerCase() === played.move.toLowerCase(), uniqueness);
    return {
      moveNumber: index + 1,
      color: played.color,
      playedMove: played.move,
      classification,
      winrateBefore: before.rootInfo.winrate,
      winrateAfter: actualWinrate,
      winrateLoss: loss,
      scoreLeadBefore: before.rootInfo.scoreLead,
      scoreLeadAfter: actualScore,
      scoreLoss,
      bestMove: best.move,
      alternatives: ranked.slice(0, 3).map((candidate) => ({
        move: candidate.move,
        winrate: candidate.winrate,
        scoreLead: candidate.scoreLead,
        visits: candidate.visits,
        pv: candidate.pv,
      })),
      explanation: explanations(input, played.move, best.move, loss, scoreLoss, best.pv),
    };
  });
  const summary = emptySummary();
  for (const move of analyses) summary[move.classification] += 1;
  return {
    contractVersion: ANALYSIS_ENGINE_CONTRACT_VERSION,
    engine: { name: "KataGo", ...engine },
    gameId: input.gameId,
    gameVersion: input.gameVersion,
    boardSize: input.boardSize,
    analyzedAt,
    moves: analyses,
    summary,
  };
}
