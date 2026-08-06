import type { JapaneseTerritoryScore } from "./japaneseScoring";
import type { JapaneseTerritoryPreview } from "./types";

export function japaneseResultString(score: JapaneseTerritoryScore): string {
  if (score.outcome.kind === "jigo") return "Draw";
  return `${score.outcome.winner === "black" ? "B" : "W"}+${score.outcome.margin}`;
}

/**
 * Converts the authoritative Japanese settlement into the stable client score
 * shape. Living stones remain available for explanation but are never added
 * to either territory total.
 */
export function toJapaneseTerritoryPreview(
  score: JapaneseTerritoryScore,
): JapaneseTerritoryPreview {
  const winner = score.outcome.kind === "jigo" ? null : score.outcome.winner;
  const margin = score.outcome.kind === "jigo" ? 0 : score.outcome.margin;
  return Object.freeze({
    black: score.blackTotal,
    white: score.whiteTotal,
    blackStones: score.livingBlackStones,
    whiteStones: score.livingWhiteStones,
    blackTerritory: score.blackTerritory,
    whiteTerritory: score.whiteTerritory,
    neutralPoints: score.damePoints,
    territoryExcludedByAgreement: score.territoryExcludedByAgreement,
    blackPrisoners: score.blackPrisonersFinal,
    whitePrisoners: score.whitePrisonersFinal,
    winner,
    margin,
    result: japaneseResultString(score),
  });
}
