import type { BoardSize, TimeControlId } from "../game/types";

export const ADAPTIVE_MATCH_POLICY_VERSION = "adaptive-global-glicko-match-v1" as const;

export const ADAPTIVE_MATCH_LIMITS = Object.freeze({
  baseRatingWindow: 100,
  ratingWindowPerWaitMinute: 20,
  maximumRatingWindow: 500,
  maximumUncertaintyAllowance: 200,
  maximumReliableLatencyMs: 2_000,
  waitPriorityHorizonSeconds: 15 * 60,
});

export type MatchPool = "guest-unrated" | "registered-rated";
export type AbandonmentRisk = "normal" | "elevated" | "restricted";
export type HandicapPreference = "even-only" | "verified-handicap-ok";

export type ExactMatchConfiguration = Readonly<{
  boardSize: BoardSize;
  timeControl: TimeControlId;
  rules: string;
  rulesProfile: string;
  rulesVersion: string;
  scoringMethod: string;
  komi: number;
  handicap: number;
}>;

type MatchEntryBase = Readonly<{
  playerKey: string;
  pool: MatchPool;
  configuration: ExactMatchConfiguration;
  waitingSinceMs: number;
  reliableLatencyMs: number | null;
  abandonmentRisk: AbandonmentRisk;
  handicapPreference: HandicapPreference;
}>;

export type RegisteredMatchEntry = MatchEntryBase & Readonly<{
  pool: "registered-rated";
  globalRating: number;
  ratingDeviation: number;
}>;

export type GuestMatchEntry = MatchEntryBase & Readonly<{
  pool: "guest-unrated";
  globalRating: null;
  ratingDeviation: null;
}>;

export type AdaptiveMatchEntry = RegisteredMatchEntry | GuestMatchEntry;

export type AdaptiveMatchIneligibility =
  | "same-player"
  | "pool-mismatch"
  | "configuration-mismatch"
  | "blocked"
  | "restricted-abandonment-risk"
  | "rating-window";

export type AdaptiveMatchEvaluation = Readonly<{
  policyVersion: typeof ADAPTIVE_MATCH_POLICY_VERSION;
  eligible: boolean;
  reasons: readonly AdaptiveMatchIneligibility[];
  score: number;
  ratingGap: number | null;
  ratingWindow: number | null;
  uncertaintyAllowance: number | null;
  components: Readonly<{
    ratingQuality: number;
    latencyQuality: number;
    abandonmentQuality: number;
    waitPriority: number;
    handicapCompatibility: number;
  }>;
  recommendedGame: "even" | "verified-handicap-review";
}>;

export type AdaptiveMatchContext = Readonly<{
  nowMs: number;
  blockedEitherDirection: boolean;
}>;

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new RangeError(`${label} must not be empty.`);
}

function validateConfiguration(configuration: ExactMatchConfiguration): void {
  if (![9, 13, 19].includes(configuration.boardSize)) {
    throw new RangeError("Board size is unsupported.");
  }
  if (!["blitz", "rapid", "classic"].includes(configuration.timeControl)) {
    throw new RangeError("Time control is unsupported.");
  }
  requireNonEmpty(configuration.rules, "Rules");
  requireNonEmpty(configuration.rulesProfile, "Rules profile");
  requireNonEmpty(configuration.rulesVersion, "Rules version");
  requireNonEmpty(configuration.scoringMethod, "Scoring method");
  requireFinite(configuration.komi, "Komi");
  if (!Number.isSafeInteger(configuration.handicap) || configuration.handicap < 0) {
    throw new RangeError("Handicap must be a non-negative integer.");
  }
}

function validateEntry(entry: AdaptiveMatchEntry, nowMs: number): void {
  requireNonEmpty(entry.playerKey, "Player key");
  validateConfiguration(entry.configuration);
  requireFinite(entry.waitingSinceMs, "Waiting timestamp");
  if (entry.waitingSinceMs > nowMs) {
    throw new RangeError("Waiting timestamp cannot be in the future.");
  }
  if (entry.reliableLatencyMs !== null) {
    requireFinite(entry.reliableLatencyMs, "Reliable latency");
    if (
      entry.reliableLatencyMs < 0
      || entry.reliableLatencyMs > ADAPTIVE_MATCH_LIMITS.maximumReliableLatencyMs
    ) {
      throw new RangeError("Reliable latency is outside the supported bound.");
    }
  }
  if (!(["normal", "elevated", "restricted"] as const).includes(entry.abandonmentRisk)) {
    throw new RangeError("Abandonment risk is unsupported.");
  }
  if (!(["even-only", "verified-handicap-ok"] as const).includes(entry.handicapPreference)) {
    throw new RangeError("Handicap preference is unsupported.");
  }
  if (entry.pool === "registered-rated") {
    requireFinite(entry.globalRating, "Global rating");
    requireFinite(entry.ratingDeviation, "Rating deviation");
    if (entry.ratingDeviation <= 0 || entry.ratingDeviation > 500) {
      throw new RangeError("Rating deviation must be greater than zero and at most 500.");
    }
  } else if (entry.pool === "guest-unrated") {
    if (entry.globalRating !== null || entry.ratingDeviation !== null) {
      throw new RangeError("Guest matchmaking cannot carry rated-player state.");
    }
  } else {
    throw new RangeError("Match pool is unsupported.");
  }
}

function sameConfiguration(
  left: ExactMatchConfiguration,
  right: ExactMatchConfiguration,
): boolean {
  return left.boardSize === right.boardSize
    && left.timeControl === right.timeControl
    && left.rules === right.rules
    && left.rulesProfile === right.rulesProfile
    && left.rulesVersion === right.rulesVersion
    && left.scoringMethod === right.scoringMethod
    && left.komi === right.komi
    && left.handicap === right.handicap;
}

function waitSeconds(entry: AdaptiveMatchEntry, nowMs: number): number {
  return (nowMs - entry.waitingSinceMs) / 1_000;
}

function latencyQuality(left: AdaptiveMatchEntry, right: AdaptiveMatchEntry): number {
  if (left.reliableLatencyMs === null || right.reliableLatencyMs === null) return 0.5;
  const worst = Math.max(left.reliableLatencyMs, right.reliableLatencyMs);
  const difference = Math.abs(left.reliableLatencyMs - right.reliableLatencyMs);
  return 1 - bounded((worst + difference) / 1_000, 0, 1);
}

function abandonmentQuality(left: AdaptiveMatchEntry, right: AdaptiveMatchEntry): number {
  const elevated = Number(left.abandonmentRisk === "elevated")
    + Number(right.abandonmentRisk === "elevated");
  return 1 - elevated * 0.25;
}

function frozenEvaluation(
  input: Omit<AdaptiveMatchEvaluation, "policyVersion">,
): AdaptiveMatchEvaluation {
  return Object.freeze({
    policyVersion: ADAPTIVE_MATCH_POLICY_VERSION,
    ...input,
    reasons: Object.freeze([...input.reasons]),
    components: Object.freeze({ ...input.components }),
  });
}

export function evaluateAdaptiveMatch(
  left: AdaptiveMatchEntry,
  right: AdaptiveMatchEntry,
  context: AdaptiveMatchContext,
): AdaptiveMatchEvaluation {
  requireFinite(context.nowMs, "Current time");
  if (typeof context.blockedEitherDirection !== "boolean") {
    throw new RangeError("Block state must be explicit.");
  }
  validateEntry(left, context.nowMs);
  validateEntry(right, context.nowMs);

  const reasons: AdaptiveMatchIneligibility[] = [];
  if (left.playerKey === right.playerKey) reasons.push("same-player");
  if (left.pool !== right.pool) reasons.push("pool-mismatch");
  if (!sameConfiguration(left.configuration, right.configuration)) {
    reasons.push("configuration-mismatch");
  }
  if (context.blockedEitherDirection) reasons.push("blocked");
  if (left.abandonmentRisk === "restricted" || right.abandonmentRisk === "restricted") {
    reasons.push("restricted-abandonment-risk");
  }

  const longestWaitSeconds = Math.max(
    waitSeconds(left, context.nowMs),
    waitSeconds(right, context.nowMs),
  );
  const waitPriority = bounded(
    longestWaitSeconds / ADAPTIVE_MATCH_LIMITS.waitPriorityHorizonSeconds,
    0,
    1,
  );
  let ratingGap: number | null = null;
  let ratingWindow: number | null = null;
  let uncertaintyAllowance: number | null = null;
  let ratingQuality = 0.75;
  if (left.pool === "registered-rated" && right.pool === "registered-rated") {
    ratingGap = Math.abs(left.globalRating - right.globalRating);
    ratingWindow = Math.min(
      ADAPTIVE_MATCH_LIMITS.maximumRatingWindow,
      ADAPTIVE_MATCH_LIMITS.baseRatingWindow
        + ADAPTIVE_MATCH_LIMITS.ratingWindowPerWaitMinute * (longestWaitSeconds / 60),
    );
    uncertaintyAllowance = Math.min(
      ADAPTIVE_MATCH_LIMITS.maximumUncertaintyAllowance,
      0.35 * (left.ratingDeviation + right.ratingDeviation),
    );
    const totalWindow = ratingWindow + uncertaintyAllowance;
    ratingQuality = 1 - bounded(ratingGap / totalWindow, 0, 1);
    if (ratingGap > totalWindow) reasons.push("rating-window");
  }

  const latency = latencyQuality(left, right);
  const abandonment = abandonmentQuality(left, right);
  const bothAcceptHandicap = left.handicapPreference === "verified-handicap-ok"
    && right.handicapPreference === "verified-handicap-ok";
  const handicapCompatibility = bothAcceptHandicap ? 1 : 0.5;
  const score = bounded(
    ratingQuality * 0.55
      + latency * 0.15
      + abandonment * 0.15
      + waitPriority * 0.1
      + handicapCompatibility * 0.05,
    0,
    1,
  );

  return frozenEvaluation({
    eligible: reasons.length === 0,
    reasons,
    score,
    ratingGap,
    ratingWindow,
    uncertaintyAllowance,
    components: {
      ratingQuality,
      latencyQuality: latency,
      abandonmentQuality: abandonment,
      waitPriority,
      handicapCompatibility,
    },
    recommendedGame: bothAcceptHandicap && (ratingGap ?? 0) >= 200
      ? "verified-handicap-review"
      : "even",
  });
}

export type RankedAdaptiveCandidate = Readonly<{
  candidate: AdaptiveMatchEntry;
  evaluation: AdaptiveMatchEvaluation;
}>;

export function rankAdaptiveMatchCandidates(
  requester: AdaptiveMatchEntry,
  candidates: readonly AdaptiveMatchEntry[],
  contextFor: (candidate: AdaptiveMatchEntry) => AdaptiveMatchContext,
): readonly RankedAdaptiveCandidate[] {
  const ranked = candidates.map((candidate) => ({
    candidate,
    evaluation: evaluateAdaptiveMatch(requester, candidate, contextFor(candidate)),
  }));
  ranked.sort((left, right) =>
    Number(right.evaluation.eligible) - Number(left.evaluation.eligible)
    || right.evaluation.score - left.evaluation.score
    || left.candidate.waitingSinceMs - right.candidate.waitingSinceMs
    || left.candidate.playerKey.localeCompare(right.candidate.playerKey)
  );
  return Object.freeze(ranked.map((item) => Object.freeze(item)));
}
