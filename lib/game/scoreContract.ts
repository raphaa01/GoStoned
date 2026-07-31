import type { ChineseAreaScore, Stone } from "./types";

export type ScoredOutcome =
  | Readonly<{ kind: "points"; winner: Stone; margin: number }>
  | Readonly<{ kind: "jigo" }>;

export type TaggedScore<ScoringRule extends string, Breakdown> = Readonly<{
  scoringRule: ScoringRule;
  outcome: ScoredOutcome;
  breakdown: Breakdown;
}>;

export type ChineseAreaComputation = TaggedScore<"chinese-area", Readonly<ChineseAreaScore>>;

export class ScoreContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoreContractError";
  }
}

function invalidChineseScore(): never {
  throw new ScoreContractError("The Chinese area score is internally inconsistent.");
}

export function tagChineseAreaScore(
  score: ChineseAreaScore,
  komi: number,
): ChineseAreaComputation {
  const countFields = [
    score.blackStones,
    score.whiteStones,
    score.blackTerritory,
    score.whiteTerritory,
    score.neutralPoints,
  ];
  if (
    !Number.isFinite(komi)
    || countFields.some((value) => !Number.isInteger(value) || value < 0)
    || !Number.isFinite(score.black)
    || score.black < 0
    || !Number.isFinite(score.white)
    || score.white < 0
    || !Number.isFinite(score.margin)
    || score.margin < 0
  ) {
    return invalidChineseScore();
  }

  const sharedNeutral = score.neutralPoints / 2;
  const expectedBlack = score.blackStones + score.blackTerritory + sharedNeutral;
  const expectedWhite = score.whiteStones + score.whiteTerritory + sharedNeutral + komi;
  const expectedWinner: Stone | null = expectedBlack === expectedWhite
    ? null
    : expectedBlack > expectedWhite ? "black" : "white";
  const expectedMargin = Math.abs(expectedBlack - expectedWhite);
  const expectedResult = expectedWinner
    ? `${expectedWinner === "black" ? "B" : "W"}+${expectedMargin}`
    : "Draw";
  if (
    score.black !== expectedBlack
    || score.white !== expectedWhite
    || score.winner !== expectedWinner
    || score.margin !== expectedMargin
    || score.result !== expectedResult
  ) {
    return invalidChineseScore();
  }

  const outcome: ScoredOutcome = expectedWinner
    ? Object.freeze({ kind: "points", winner: expectedWinner, margin: expectedMargin })
    : Object.freeze({ kind: "jigo" });
  return Object.freeze({
    scoringRule: "chinese-area",
    outcome,
    breakdown: Object.freeze({
      black: score.black,
      white: score.white,
      blackStones: score.blackStones,
      whiteStones: score.whiteStones,
      blackTerritory: score.blackTerritory,
      whiteTerritory: score.whiteTerritory,
      neutralPoints: score.neutralPoints,
      winner: score.winner,
      margin: score.margin,
      result: score.result,
    }),
  });
}
