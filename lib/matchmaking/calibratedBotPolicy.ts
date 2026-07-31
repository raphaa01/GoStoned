import { createHash } from "node:crypto";
import type { BoardSize, TimeControlId } from "../game/types";

export const CALIBRATED_BOT_PROFILE_CONTRACT_VERSION = "calibrated-bot-profile-v1" as const;
export const BOT_CALIBRATION_ACCEPTANCE_POLICY_VERSION = "bot-calibration-acceptance-v1" as const;
export const BOT_OPPONENT_BINDING_VERSION = "bot-opponent-binding-v1" as const;

export const BOT_CALIBRATION_LIMITS = Object.freeze({
  minimumGames: 500,
  minimumHoldoutGames: 100,
  minimumDistinctRegisteredHumans: 100,
  minimumGamesPerSupportedConfiguration: 50,
  maximumStandardError: 75,
  maximumFixedRatingDistance: 100,
});

export type BotGameConfiguration = Readonly<{
  boardSize: BoardSize;
  timeControl: TimeControlId;
  rulesProfile: string;
  rulesVersion: string;
  komi: number;
  handicap: number;
}>;

export type CalibratedBotProfile = Readonly<{
  contractVersion: typeof CALIBRATED_BOT_PROFILE_CONTRACT_VERSION;
  profileId: string;
  transparentName: string;
  engineFamily: string;
  engineVersion: string;
  modelVersion: string;
  configVersion: string;
  fixedRating: number;
  fixedRatingDeviation: number;
  supportedConfigurations: readonly BotGameConfiguration[];
  handicapMode: "even" | "verified-handicap";
}>;

export type BotCalibrationCoverage = Readonly<{
  configurationKey: string;
  games: number;
}>;

export type BotCalibrationEvidence = Readonly<{
  acceptancePolicyVersion: typeof BOT_CALIBRATION_ACCEPTANCE_POLICY_VERSION;
  profileContractVersion: typeof CALIBRATED_BOT_PROFILE_CONTRACT_VERSION;
  profileId: string;
  profileFingerprint: string;
  sourceRevision: string;
  datasetDigest: string;
  runnerDigest: string;
  reproductionCommand: string;
  games: number;
  holdoutGames: number;
  distinctRegisteredHumans: number;
  estimatedRating: number;
  standardError: number;
  unresolvedAuditFindings: number;
  coverage: readonly BotCalibrationCoverage[];
}>;

export type BotCalibrationRejection =
  | "missing-evidence"
  | "profile-mismatch"
  | "version-mismatch"
  | "invalid-reproducibility-evidence"
  | "insufficient-games"
  | "insufficient-holdout"
  | "insufficient-human-opponents"
  | "inconsistent-sample-counts"
  | "incomplete-configuration-coverage"
  | "imprecise-estimate"
  | "fixed-rating-not-supported"
  | "fixed-deviation-understates-uncertainty"
  | "unresolved-audit-findings";

export type BotCalibrationDecision = Readonly<{
  policyVersion: typeof BOT_CALIBRATION_ACCEPTANCE_POLICY_VERSION;
  acceptedForRatedPlay: boolean;
  reasons: readonly BotCalibrationRejection[];
}>;

export type BotProfileCandidate = Readonly<{
  profile: CalibratedBotProfile;
  evidence: BotCalibrationEvidence | null;
}>;

export type BotOpponentBinding = Readonly<{
  bindingVersion: typeof BOT_OPPONENT_BINDING_VERSION;
  profileContractVersion: typeof CALIBRATED_BOT_PROFILE_CONTRACT_VERSION;
  profileId: string;
  profileFingerprint: string;
  engineFamily: string;
  engineVersion: string;
  modelVersion: string;
  configVersion: string;
  opponentRating: number;
  opponentRatingDeviation: number;
  configurationKey: string;
  creditMode: "fixed-versioned-profile";
}>;

export type BotProfileSelection = Readonly<{
  profile: CalibratedBotProfile;
  binding: BotOpponentBinding;
  uncertaintyAdjustedDistance: number;
}>;

export type BotExecutionIdentity = Readonly<{
  profileId: string;
  engineFamily: string;
  engineVersion: string;
  modelVersion: string;
  configVersion: string;
}>;

const PROFILE_ID = /^bot:[a-z0-9][a-z0-9-]{1,62}:v[1-9]\d*$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const GIT_REVISION = /^[0-9a-f]{40}$/;

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0 || value.length > 160) {
    throw new RangeError(`${label} must contain 1 through 160 characters.`);
  }
}

function configurationRecord(configuration: BotGameConfiguration): Record<string, unknown> {
  return {
    boardSize: configuration.boardSize,
    timeControl: configuration.timeControl,
    rulesProfile: configuration.rulesProfile,
    rulesVersion: configuration.rulesVersion,
    komi: configuration.komi,
    handicap: configuration.handicap,
  };
}

export function botConfigurationKey(configuration: BotGameConfiguration): string {
  validateConfiguration(configuration);
  return createHash("sha256")
    .update(JSON.stringify(configurationRecord(configuration)), "utf8")
    .digest("hex");
}

function validateConfiguration(configuration: BotGameConfiguration): void {
  if (![9, 13, 19].includes(configuration.boardSize)) {
    throw new RangeError("Bot board size is unsupported.");
  }
  if (!["blitz", "rapid", "classic"].includes(configuration.timeControl)) {
    throw new RangeError("Bot time control is unsupported.");
  }
  requireNonEmpty(configuration.rulesProfile, "Bot rules profile");
  requireNonEmpty(configuration.rulesVersion, "Bot rules version");
  requireFinite(configuration.komi, "Bot komi");
  if (!Number.isSafeInteger(configuration.handicap) || configuration.handicap < 0) {
    throw new RangeError("Bot handicap must be a non-negative integer.");
  }
}

export function validateCalibratedBotProfile(profile: CalibratedBotProfile): void {
  if (profile.contractVersion !== CALIBRATED_BOT_PROFILE_CONTRACT_VERSION) {
    throw new RangeError("Bot profile contract version is unsupported.");
  }
  if (!PROFILE_ID.test(profile.profileId)) throw new RangeError("Bot profile id is invalid.");
  requireNonEmpty(profile.transparentName, "Transparent bot name");
  requireNonEmpty(profile.engineFamily, "Bot engine family");
  requireNonEmpty(profile.engineVersion, "Bot engine version");
  requireNonEmpty(profile.modelVersion, "Bot model version");
  requireNonEmpty(profile.configVersion, "Bot config version");
  requireFinite(profile.fixedRating, "Fixed bot rating");
  requireFinite(profile.fixedRatingDeviation, "Fixed bot rating deviation");
  if (profile.fixedRatingDeviation <= 0 || profile.fixedRatingDeviation > 350) {
    throw new RangeError("Fixed bot rating deviation must be greater than zero and at most 350.");
  }
  if (profile.handicapMode !== "even" && profile.handicapMode !== "verified-handicap") {
    throw new RangeError("Bot handicap mode is unsupported.");
  }
  if (profile.supportedConfigurations.length === 0) {
    throw new RangeError("A bot profile must declare supported configurations.");
  }
  const keys = profile.supportedConfigurations.map(botConfigurationKey);
  if (new Set(keys).size !== keys.length) {
    throw new RangeError("Bot profile configurations must be unique.");
  }
  for (const configuration of profile.supportedConfigurations) {
    if (profile.handicapMode === "even" && configuration.handicap !== 0) {
      throw new RangeError("An even-only bot profile cannot declare handicap configurations.");
    }
    if (profile.handicapMode === "verified-handicap" && configuration.handicap === 0) {
      throw new RangeError("A handicap bot profile must declare a verified non-zero handicap.");
    }
  }
}

export function evaluateBotCalibration(
  profile: CalibratedBotProfile,
  evidence: BotCalibrationEvidence | null,
): BotCalibrationDecision {
  validateCalibratedBotProfile(profile);
  const reasons: BotCalibrationRejection[] = [];
  if (!evidence) {
    reasons.push("missing-evidence");
  } else {
    if (
      evidence.profileId !== profile.profileId
      || evidence.profileFingerprint !== calibratedBotProfileFingerprint(profile)
    ) reasons.push("profile-mismatch");
    if (
      evidence.acceptancePolicyVersion !== BOT_CALIBRATION_ACCEPTANCE_POLICY_VERSION
      || evidence.profileContractVersion !== CALIBRATED_BOT_PROFILE_CONTRACT_VERSION
    ) reasons.push("version-mismatch");
    if (
      !GIT_REVISION.test(evidence.sourceRevision)
      || !SHA256.test(evidence.datasetDigest)
      || !SHA256.test(evidence.runnerDigest)
      || evidence.reproductionCommand.trim().length === 0
      || evidence.reproductionCommand.length > 500
    ) reasons.push("invalid-reproducibility-evidence");
    if (!Number.isSafeInteger(evidence.games) || evidence.games < BOT_CALIBRATION_LIMITS.minimumGames) {
      reasons.push("insufficient-games");
    }
    if (
      !Number.isSafeInteger(evidence.holdoutGames)
      || evidence.holdoutGames < BOT_CALIBRATION_LIMITS.minimumHoldoutGames
    ) reasons.push("insufficient-holdout");
    if (
      !Number.isSafeInteger(evidence.distinctRegisteredHumans)
      || evidence.distinctRegisteredHumans < BOT_CALIBRATION_LIMITS.minimumDistinctRegisteredHumans
    ) reasons.push("insufficient-human-opponents");
    if (
      Number.isSafeInteger(evidence.games)
      && Number.isSafeInteger(evidence.holdoutGames)
      && Number.isSafeInteger(evidence.distinctRegisteredHumans)
      && (
        evidence.holdoutGames > evidence.games
        || evidence.distinctRegisteredHumans > evidence.games
      )
    ) reasons.push("inconsistent-sample-counts");
    requireFinite(evidence.estimatedRating, "Estimated bot rating");
    requireFinite(evidence.standardError, "Bot rating standard error");
    if (evidence.standardError <= 0 || evidence.standardError > BOT_CALIBRATION_LIMITS.maximumStandardError) {
      reasons.push("imprecise-estimate");
    }
    const supported = new Set(profile.supportedConfigurations.map(botConfigurationKey));
    const coverage = new Map<string, number>();
    for (const row of evidence.coverage) {
      if (
        !supported.has(row.configurationKey)
        || coverage.has(row.configurationKey)
        || !Number.isSafeInteger(row.games)
        || row.games < BOT_CALIBRATION_LIMITS.minimumGamesPerSupportedConfiguration
      ) {
        reasons.push("incomplete-configuration-coverage");
        break;
      }
      coverage.set(row.configurationKey, row.games);
    }
    const coveredGames = [...coverage.values()].reduce((sum, games) => sum + games, 0);
    if (
      (coverage.size !== supported.size || coveredGames !== evidence.games)
      && !reasons.includes("incomplete-configuration-coverage")
    ) {
      reasons.push("incomplete-configuration-coverage");
    }
    const supportedDistance = Math.max(
      BOT_CALIBRATION_LIMITS.maximumFixedRatingDistance,
      evidence.standardError * 2,
    );
    if (Math.abs(profile.fixedRating - evidence.estimatedRating) > supportedDistance) {
      reasons.push("fixed-rating-not-supported");
    }
    if (profile.fixedRatingDeviation < evidence.standardError) {
      reasons.push("fixed-deviation-understates-uncertainty");
    }
    if (
      !Number.isSafeInteger(evidence.unresolvedAuditFindings)
      || evidence.unresolvedAuditFindings !== 0
    ) reasons.push("unresolved-audit-findings");
  }
  return Object.freeze({
    policyVersion: BOT_CALIBRATION_ACCEPTANCE_POLICY_VERSION,
    acceptedForRatedPlay: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}

function supportsConfiguration(
  profile: CalibratedBotProfile,
  requested: BotGameConfiguration,
): boolean {
  const key = botConfigurationKey(requested);
  return profile.supportedConfigurations.some((configuration) =>
    botConfigurationKey(configuration) === key
  );
}

export function calibratedBotProfileFingerprint(profile: CalibratedBotProfile): string {
  const record = {
    contractVersion: profile.contractVersion,
    profileId: profile.profileId,
    transparentName: profile.transparentName,
    engineFamily: profile.engineFamily,
    engineVersion: profile.engineVersion,
    modelVersion: profile.modelVersion,
    configVersion: profile.configVersion,
    fixedRating: profile.fixedRating,
    fixedRatingDeviation: profile.fixedRatingDeviation,
    configurations: profile.supportedConfigurations.map(botConfigurationKey).sort(),
    handicapMode: profile.handicapMode,
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(record), "utf8").digest("hex")}`;
}

export function createBotOpponentBinding(
  profile: CalibratedBotProfile,
  configuration: BotGameConfiguration,
): BotOpponentBinding {
  validateCalibratedBotProfile(profile);
  if (!supportsConfiguration(profile, configuration)) {
    throw new RangeError("Bot profile does not support the requested configuration.");
  }
  return Object.freeze({
    bindingVersion: BOT_OPPONENT_BINDING_VERSION,
    profileContractVersion: profile.contractVersion,
    profileId: profile.profileId,
    profileFingerprint: calibratedBotProfileFingerprint(profile),
    engineFamily: profile.engineFamily,
    engineVersion: profile.engineVersion,
    modelVersion: profile.modelVersion,
    configVersion: profile.configVersion,
    opponentRating: profile.fixedRating,
    opponentRatingDeviation: profile.fixedRatingDeviation,
    configurationKey: botConfigurationKey(configuration),
    creditMode: "fixed-versioned-profile",
  });
}

export function selectNearestCalibratedBot(
  human: Readonly<{ globalRating: number; ratingDeviation: number }>,
  configuration: BotGameConfiguration,
  candidates: readonly BotProfileCandidate[],
  handicapPreference: "even-only" | "verified-handicap-ok",
): BotProfileSelection | null {
  requireFinite(human.globalRating, "Human global rating");
  requireFinite(human.ratingDeviation, "Human rating deviation");
  if (human.ratingDeviation <= 0 || human.ratingDeviation > 500) {
    throw new RangeError("Human rating deviation must be greater than zero and at most 500.");
  }
  if (handicapPreference !== "even-only" && handicapPreference !== "verified-handicap-ok") {
    throw new RangeError("Human handicap preference is unsupported.");
  }
  const eligible = candidates.flatMap(({ profile, evidence }) => {
    const decision = evaluateBotCalibration(profile, evidence);
    if (!decision.acceptedForRatedPlay || !supportsConfiguration(profile, configuration)) return [];
    if (handicapPreference === "even-only" && profile.handicapMode !== "even") return [];
    const combinedUncertainty = Math.sqrt(
      human.ratingDeviation ** 2 + profile.fixedRatingDeviation ** 2,
    );
    const distance = Math.abs(human.globalRating - profile.fixedRating) / combinedUncertainty
      + 0.25 * Math.abs(human.ratingDeviation - profile.fixedRatingDeviation) / 350;
    return [{ profile, distance }];
  });
  eligible.sort((left, right) =>
    left.distance - right.distance || left.profile.profileId.localeCompare(right.profile.profileId)
  );
  const selected = eligible[0];
  if (!selected) return null;
  const profile = Object.freeze({
    ...selected.profile,
    supportedConfigurations: Object.freeze(
      selected.profile.supportedConfigurations.map((item) => Object.freeze({ ...item })),
    ),
  });
  return Object.freeze({
    profile,
    binding: createBotOpponentBinding(profile, configuration),
    uncertaintyAdjustedDistance: selected.distance,
  });
}

export function botExecutionMatchesBinding(
  binding: BotOpponentBinding,
  profile: CalibratedBotProfile,
  execution: BotExecutionIdentity,
): boolean {
  try {
    return binding.bindingVersion === BOT_OPPONENT_BINDING_VERSION
      && binding.profileContractVersion === profile.contractVersion
      && binding.profileId === profile.profileId
      && binding.profileFingerprint === calibratedBotProfileFingerprint(profile)
      && binding.opponentRating === profile.fixedRating
      && binding.opponentRatingDeviation === profile.fixedRatingDeviation
      && binding.creditMode === "fixed-versioned-profile"
      && execution.profileId === profile.profileId
      && execution.engineFamily === profile.engineFamily
      && execution.engineVersion === profile.engineVersion
      && execution.modelVersion === profile.modelVersion
      && execution.configVersion === profile.configVersion;
  } catch {
    return false;
  }
}

export type CompetitiveActorClass =
  | "registered-human"
  | "guest-human"
  | "calibrated-bot";

export function classifyCompetitiveActor(actorClass: CompetitiveActorClass): Readonly<{
  isHuman: boolean;
  humanOnlyStatisticsEligible: boolean;
  registeredRatedPopulationEligible: boolean;
}> {
  if (!(["registered-human", "guest-human", "calibrated-bot"] as const).includes(actorClass)) {
    throw new RangeError("Competitive actor class is unsupported.");
  }
  return Object.freeze({
    isHuman: actorClass !== "calibrated-bot",
    humanOnlyStatisticsEligible: actorClass !== "calibrated-bot",
    registeredRatedPopulationEligible: actorClass === "registered-human",
  });
}
