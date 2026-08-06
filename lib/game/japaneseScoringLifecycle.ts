import type { Stone } from "./types";

export const MAX_JAPANESE_SCORING_RESUMPTIONS = 3 as const;
export const DEFAULT_JAPANESE_SCORING_DECISION_WINDOW_SECONDS = 5 * 60;
export const JAPANESE_SCORING_DECISION_WINDOW_ENV =
  "JAPANESE_SCORING_DECISION_SECONDS" as const;

export type JapaneseScoringParticipation = Readonly<{
  blackParticipated: boolean;
  whiteParticipated: boolean;
}>;

export type JapaneseScoringDeadlineDecision =
  | Readonly<{
      kind: "abandonment";
      abandonedBy: Stone;
      winner: Stone;
    }>
  | Readonly<{
      kind: "no-result";
      reason: "no-participation" | "unresolved-after-participation";
    }>;

export function japaneseScoringDecisionWindowSeconds(
  raw = process.env[JAPANESE_SCORING_DECISION_WINDOW_ENV],
): number {
  if (raw === undefined || raw === "") {
    return DEFAULT_JAPANESE_SCORING_DECISION_WINDOW_SECONDS;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${JAPANESE_SCORING_DECISION_WINDOW_ENV} must be a whole number of seconds.`);
  }
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds < 30 || seconds > 60 * 60) {
    throw new Error(`${JAPANESE_SCORING_DECISION_WINDOW_ENV} must be between 30 and 3600.`);
  }
  return seconds;
}

export function isJapaneseFinalResolutionPhase(resumptionCount: number): boolean {
  if (!Number.isInteger(resumptionCount) || resumptionCount < 0) {
    throw new Error("Japanese resumption count must be a non-negative integer.");
  }
  return resumptionCount >= MAX_JAPANESE_SCORING_RESUMPTIONS;
}

export function japaneseScoringResumptionsRemaining(resumptionCount: number): number {
  if (!Number.isInteger(resumptionCount) || resumptionCount < 0) {
    throw new Error("Japanese resumption count must be a non-negative integer.");
  }
  return Math.max(0, MAX_JAPANESE_SCORING_RESUMPTIONS - resumptionCount);
}

export function decideJapaneseScoringDeadline(
  participation: JapaneseScoringParticipation,
): JapaneseScoringDeadlineDecision {
  if (participation.blackParticipated && participation.whiteParticipated) {
    return Object.freeze({
      kind: "no-result",
      reason: "unresolved-after-participation",
    });
  }
  if (!participation.blackParticipated && !participation.whiteParticipated) {
    return Object.freeze({ kind: "no-result", reason: "no-participation" });
  }
  const abandonedBy = participation.blackParticipated ? "white" : "black";
  return Object.freeze({
    kind: "abandonment",
    abandonedBy,
    winner: abandonedBy === "black" ? "white" : "black",
  });
}
