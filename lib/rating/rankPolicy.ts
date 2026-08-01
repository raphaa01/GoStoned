export const RANK_CONVERSION_POLICY_VERSION = "gostone-rank-v1" as const;
export const DEFAULT_RATING_DISPLAY_PREFERENCE = "both" as const;

const KYU_CEILING_RATING = 2000;
const KYU_RATING_STEP = 50;
const DAN_RATING_STEP = 100;

export type GoRank = Readonly<{
  kind: "kyu" | "dan";
  value: number;
  policyVersion: typeof RANK_CONVERSION_POLICY_VERSION;
}>;

export type RatingDisplayPreference = "rank-primary" | "rating-primary" | "both";
export type RatingPresentationLocale = "en" | "de";

export type RatingPresentation = Readonly<{
  preference: RatingDisplayPreference;
  rank: GoRank;
  rankLabel: string;
  numericLabel: string;
  primaryLabel: string;
  secondaryLabel: string | null;
  combinedLabel: string;
  policyVersion: typeof RANK_CONVERSION_POLICY_VERSION;
}>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function requireFiniteRating(rating: number): void {
  if (!Number.isFinite(rating)) throw new RangeError("Rating must be finite.");
}

/**
 * Converts the global numerical rating with GoStone's versioned v1 policy.
 * Kyu ranks use 50-point steps below 2000; dan ranks use 100-point steps from
 * 2000. Display is clamped to the supported 30 kyu through 9 dan range.
 */
export function deriveGoRank(rating: number): GoRank {
  requireFiniteRating(rating);
  if (rating < KYU_CEILING_RATING) {
    return Object.freeze({
      kind: "kyu",
      value: clamp(Math.ceil((KYU_CEILING_RATING - rating) / KYU_RATING_STEP), 1, 30),
      policyVersion: RANK_CONVERSION_POLICY_VERSION,
    });
  }
  return Object.freeze({
    kind: "dan",
    value: clamp(1 + Math.floor((rating - KYU_CEILING_RATING) / DAN_RATING_STEP), 1, 9),
    policyVersion: RANK_CONVERSION_POLICY_VERSION,
  });
}

export function formatGoRank(
  rank: Pick<GoRank, "kind" | "value">,
  locale: RatingPresentationLocale,
): string {
  if (rank.kind !== "kyu" && rank.kind !== "dan") {
    throw new RangeError("Rank kind must be kyu or dan.");
  }
  const maximum = rank.kind === "kyu" ? 30 : 9;
  if (!Number.isInteger(rank.value) || rank.value < 1 || rank.value > maximum) {
    throw new RangeError(`Rank value must be between 1 and ${maximum}.`);
  }
  if (locale !== "en" && locale !== "de") {
    throw new RangeError("Rating presentation locale is invalid.");
  }
  if (locale === "de") {
    return `${rank.value}. ${rank.kind === "kyu" ? "Kyu" : "Dan"}`;
  }
  return `${rank.value} ${rank.kind}`;
}

export function presentRating(
  rating: number,
  preference: RatingDisplayPreference = DEFAULT_RATING_DISPLAY_PREFERENCE,
  locale: RatingPresentationLocale = "en",
): RatingPresentation {
  requireFiniteRating(rating);
  if (
    preference !== "rank-primary"
    && preference !== "rating-primary"
    && preference !== "both"
  ) {
    throw new RangeError("Rating display preference is invalid.");
  }
  const rank = deriveGoRank(rating);
  const rankLabel = formatGoRank(rank, locale);
  const numericLabel = String(Math.round(rating));
  const combinedLabel = `${rankLabel} · ${numericLabel}`;
  const primaryLabel = preference === "rating-primary" ? numericLabel : preference === "both"
    ? combinedLabel
    : rankLabel;
  const secondaryLabel = preference === "both"
    ? null
    : preference === "rating-primary" ? rankLabel : numericLabel;

  return Object.freeze({
    preference,
    rank,
    rankLabel,
    numericLabel,
    primaryLabel,
    secondaryLabel,
    combinedLabel,
    policyVersion: RANK_CONVERSION_POLICY_VERSION,
  });
}
