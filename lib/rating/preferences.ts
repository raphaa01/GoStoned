import type { RatingDisplayPreference } from "./rankPolicy";

export const STARTING_STRENGTH_POLICY_VERSION = "starting-strength-v1" as const;

export type StartingStrengthEstimate =
  | "unspecified"
  | "new"
  | "beginner"
  | "intermediate"
  | "experienced"
  | "known";

export type RatingPreferences = Readonly<{
  displayPreference: RatingDisplayPreference;
  botMatchPreference: BotMatchPreference;
}>;

export type BotMatchPreference =
  | "never"
  | "calibrated-rated-after-wait";

export type StartingStrength = Readonly<{
  estimate: StartingStrengthEstimate;
  knownRank: string | null;
}>;

export const KNOWN_RANK_OPTIONS = Object.freeze([
  ...Array.from({ length: 30 }, (_, index) => `${30 - index}k`),
  ...Array.from({ length: 9 }, (_, index) => `${index + 1}d`),
]);

const DISPLAY_PREFERENCES = new Set<RatingDisplayPreference>([
  "rank-primary",
  "rating-primary",
  "both",
]);
const BOT_MATCH_PREFERENCES = new Set<BotMatchPreference>([
  "never",
  "calibrated-rated-after-wait",
]);
const STARTING_ESTIMATES = new Set<StartingStrengthEstimate>([
  "unspecified",
  "new",
  "beginner",
  "intermediate",
  "experienced",
  "known",
]);
const KNOWN_RANK = /^(?:([1-9]|[12]\d|30)k|([1-9])d)$/;

export function parseRatingDisplayPreference(value: unknown): RatingDisplayPreference {
  if (typeof value !== "string" || !DISPLAY_PREFERENCES.has(value as RatingDisplayPreference)) {
    throw new RangeError("Rating display preference is invalid.");
  }
  return value as RatingDisplayPreference;
}

export function parseStartingStrength(
  estimateValue: unknown,
  knownRankValue: unknown,
): StartingStrength {
  if (
    typeof estimateValue !== "string"
    || !STARTING_ESTIMATES.has(estimateValue as StartingStrengthEstimate)
  ) {
    throw new RangeError("Starting-strength estimate is invalid.");
  }
  const estimate = estimateValue as StartingStrengthEstimate;
  const knownRank = typeof knownRankValue === "string" && knownRankValue.trim() !== ""
    ? knownRankValue.trim().toLowerCase()
    : null;
  if (estimate === "known") {
    if (!knownRank || !KNOWN_RANK.test(knownRank)) {
      throw new RangeError("Known rank must be between 30k and 9d.");
    }
  } else if (knownRank !== null) {
    throw new RangeError("Known rank is allowed only with the known-rank estimate.");
  }
  return Object.freeze({ estimate, knownRank });
}

export function initialRatingForStartingStrength(strength: StartingStrength): number {
  switch (strength.estimate) {
    case "new": return 500;
    case "beginner": return 900;
    case "intermediate": return 1400;
    case "experienced": return 1800;
    case "unspecified": return 1200;
    case "known": {
      const match = strength.knownRank?.match(KNOWN_RANK);
      if (!match) throw new RangeError("Known rank must be between 30k and 9d.");
      if (match[1]) return 2000 - Number(match[1]) * 50;
      return 2000 + (Number(match[2]) - 1) * 100;
    }
  }
}

export function parseRatingPreferences(value: unknown): RatingPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Rating preferences must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2
    || !("displayPreference" in record)
    || !("botMatchPreference" in record)
    || typeof record.botMatchPreference !== "string"
    || !BOT_MATCH_PREFERENCES.has(record.botMatchPreference as BotMatchPreference)
  ) {
    throw new RangeError("Rating preferences have an invalid shape.");
  }
  return Object.freeze({
    displayPreference: parseRatingDisplayPreference(record.displayPreference),
    botMatchPreference: record.botMatchPreference as BotMatchPreference,
  });
}
