import { JAPANESE_1989_RULES_PROFILE } from "./japanesePolicyContract";

export const LEGACY_IMMEDIATE_AREA_PROFILE = "legacy-immediate-area" as const;
export const CURRENT_CHINESE_RULES_PROFILE = "chinese-2002-gostone-v1" as const;
export const DEFAULT_RULES_PROFILE = JAPANESE_1989_RULES_PROFILE;

export type Ruleset = "chinese" | "japanese";
export type RulesProfile =
  | typeof LEGACY_IMMEDIATE_AREA_PROFILE
  | typeof CURRENT_CHINESE_RULES_PROFILE
  | typeof JAPANESE_1989_RULES_PROFILE;
export type ScoringMethod = "area" | "territory";

export type RulesPolicy = Readonly<{
  profile: RulesProfile;
  ruleset: Ruleset;
  scoringMethod: ScoringMethod;
  scoringRule: "chinese-area" | "japanese-territory-with-prisoners";
  defaultKomi: number;
  supportedKomi: readonly number[];
  supportedHandicaps: readonly number[];
  initialTurn: "black";
  turnSource: "move-log" | "persisted" | "japanese-authority";
  scoringLifecycle: "immediate" | "agreement";
  scoringResponseWindowMs: number | null;
  repetitionRule: "positional-superko" | "japanese-simple-ko";
  resumeTurnRule: "claim-dependent" | "opponent-first" | "none";
}>;

export type RulesConfiguration = Readonly<{
  ruleset: Ruleset;
  rulesProfile: RulesProfile;
  scoringMethod: ScoringMethod;
  komi: number;
  handicap: number;
}>;

export type ResolvedRulesConfiguration = RulesConfiguration & Readonly<{
  policy: RulesPolicy;
}>;

export type StoredRulesConfiguration = {
  ruleset: unknown;
  rulesProfile: unknown;
  scoringMethod: unknown;
  komi: unknown;
  handicap: unknown;
};

export type RulesPolicyErrorCode =
  | "unsupported_rules_profile"
  | "rules_policy_mismatch"
  | "invalid_rules_komi"
  | "unsupported_rules_handicap";

export class UnsupportedRulesPolicyError extends Error {
  constructor(
    public readonly code: RulesPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UnsupportedRulesPolicyError";
  }
}

const legacyPolicy = Object.freeze({
  profile: LEGACY_IMMEDIATE_AREA_PROFILE,
  ruleset: "chinese",
  scoringMethod: "area",
  scoringRule: "chinese-area",
  defaultKomi: 7.5,
  supportedKomi: Object.freeze([6.5, 7.5]),
  supportedHandicaps: Object.freeze([0]),
  initialTurn: "black",
  turnSource: "move-log",
  scoringLifecycle: "immediate",
  scoringResponseWindowMs: null,
  repetitionRule: "positional-superko",
  resumeTurnRule: "none",
} as const satisfies RulesPolicy);

const currentChinesePolicy = Object.freeze({
  profile: CURRENT_CHINESE_RULES_PROFILE,
  ruleset: "chinese",
  scoringMethod: "area",
  scoringRule: "chinese-area",
  defaultKomi: 7.5,
  supportedKomi: Object.freeze([7.5]),
  supportedHandicaps: Object.freeze([0]),
  initialTurn: "black",
  turnSource: "persisted",
  scoringLifecycle: "agreement",
  scoringResponseWindowMs: 10 * 60 * 1_000,
  repetitionRule: "positional-superko",
  resumeTurnRule: "claim-dependent",
} as const satisfies RulesPolicy);

const japanesePolicy = Object.freeze({
  profile: JAPANESE_1989_RULES_PROFILE,
  ruleset: "japanese",
  scoringMethod: "territory",
  scoringRule: "japanese-territory-with-prisoners",
  defaultKomi: 6.5,
  supportedKomi: Object.freeze([6.5]),
  supportedHandicaps: Object.freeze([0]),
  initialTurn: "black",
  turnSource: "japanese-authority",
  scoringLifecycle: "agreement",
  scoringResponseWindowMs: 5 * 60 * 1_000,
  repetitionRule: "japanese-simple-ko",
  resumeTurnRule: "opponent-first",
} as const satisfies RulesPolicy);

export const RULES_POLICIES = Object.freeze({
  [LEGACY_IMMEDIATE_AREA_PROFILE]: legacyPolicy,
  [CURRENT_CHINESE_RULES_PROFILE]: currentChinesePolicy,
  [JAPANESE_1989_RULES_PROFILE]: japanesePolicy,
} satisfies Record<RulesProfile, RulesPolicy>);

export const DEFAULT_MATCH_RULES = Object.freeze({
  ruleset: japanesePolicy.ruleset,
  rulesProfile: japanesePolicy.profile,
  scoringMethod: japanesePolicy.scoringMethod,
  komi: japanesePolicy.defaultKomi,
  handicap: japanesePolicy.supportedHandicaps[0],
} satisfies RulesConfiguration);

export function resolveRulesPolicy(profile: unknown): RulesPolicy {
  if (
    typeof profile !== "string"
    || !Object.prototype.hasOwnProperty.call(RULES_POLICIES, profile)
  ) {
    throw new UnsupportedRulesPolicyError(
      "unsupported_rules_profile",
      "The stored rules profile is not supported by this application version.",
    );
  }
  return RULES_POLICIES[profile as RulesProfile];
}

function finiteKomi(value: unknown): number {
  if (
    (typeof value !== "number" && typeof value !== "string")
    || (typeof value === "string" && value.trim() === "")
    || (typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value.trim()))
  ) {
    throw new UnsupportedRulesPolicyError("invalid_rules_komi", "The stored komi is invalid.");
  }
  const komi = Number(value);
  if (!Number.isFinite(komi)) {
    throw new UnsupportedRulesPolicyError(
      "invalid_rules_komi",
      "The stored komi is not finite.",
    );
  }
  return komi;
}

export function resolveRulesConfiguration(
  input: StoredRulesConfiguration,
): ResolvedRulesConfiguration {
  const policy = resolveRulesPolicy(input.rulesProfile);
  if (input.ruleset !== policy.ruleset || input.scoringMethod !== policy.scoringMethod) {
    throw new UnsupportedRulesPolicyError(
      "rules_policy_mismatch",
      "The stored rules configuration does not match its versioned profile.",
    );
  }
  const komi = finiteKomi(input.komi);
  if (!policy.supportedKomi.includes(komi)) {
    throw new UnsupportedRulesPolicyError(
      "invalid_rules_komi",
      "The stored komi is not supported by this versioned profile.",
    );
  }
  if (
    !Number.isInteger(input.handicap)
    || !policy.supportedHandicaps.includes(input.handicap as number)
  ) {
    throw new UnsupportedRulesPolicyError(
      "unsupported_rules_handicap",
      "The stored handicap is not supported by this versioned profile.",
    );
  }
  return Object.freeze({
    ruleset: policy.ruleset,
    rulesProfile: policy.profile,
    scoringMethod: policy.scoringMethod,
    komi,
    handicap: input.handicap as number,
    policy,
  });
}

export function sameRulesConfiguration(
  left: RulesConfiguration,
  right: RulesConfiguration,
): boolean {
  return left.ruleset === right.ruleset
    && left.rulesProfile === right.rulesProfile
    && left.scoringMethod === right.scoringMethod
    && left.komi === right.komi
    && left.handicap === right.handicap;
}

export function resolveScoringConfiguration(
  game: RulesConfiguration,
  scoring: StoredRulesConfiguration,
): ResolvedRulesConfiguration {
  const resolved = resolveRulesConfiguration(scoring);
  if (
    !sameRulesConfiguration(game, resolved)
    || resolved.policy.scoringLifecycle !== "agreement"
  ) {
    throw new UnsupportedRulesPolicyError(
      "rules_policy_mismatch",
      "The scoring snapshot does not match the game's versioned rules configuration.",
    );
  }
  return resolved;
}
