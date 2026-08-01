import assert from "node:assert/strict";
import test from "node:test";
import {
  BOT_CALIBRATION_ACCEPTANCE_POLICY_VERSION,
  CALIBRATED_BOT_PROFILE_CONTRACT_VERSION,
  botConfigurationKey,
  botExecutionMatchesBinding,
  calibratedBotProfileFingerprint,
  classifyCompetitiveActor,
  createBotOpponentBinding,
  evaluateBotCalibration,
  selectNearestCalibratedBot,
  validateCalibratedBotProfile,
  type BotCalibrationEvidence,
  type BotGameConfiguration,
  type CalibratedBotProfile,
} from "./calibratedBotPolicy";

const configuration: BotGameConfiguration = Object.freeze({
  boardSize: 19,
  timeControl: "rapid",
  rulesProfile: "chinese-2002-gostone-v1",
  rulesVersion: "chinese-2002-gostone-v1",
  komi: 7.5,
  handicap: 0,
});

function profile(
  id: string,
  rating: number,
  deviation: number,
  overrides: Partial<CalibratedBotProfile> = {},
): CalibratedBotProfile {
  return {
    contractVersion: CALIBRATED_BOT_PROFILE_CONTRACT_VERSION,
    profileId: id,
    transparentName: `GoStone Bot ${id}`,
    engineFamily: "test-engine",
    engineVersion: "engine-v1",
    modelVersion: "model-v1",
    configVersion: "config-v1",
    fixedRating: rating,
    fixedRatingDeviation: deviation,
    supportedConfigurations: [configuration],
    handicapMode: "even",
    ...overrides,
  };
}

function evidence(
  bot: CalibratedBotProfile,
  overrides: Partial<BotCalibrationEvidence> = {},
): BotCalibrationEvidence {
  return {
    acceptancePolicyVersion: BOT_CALIBRATION_ACCEPTANCE_POLICY_VERSION,
    profileContractVersion: CALIBRATED_BOT_PROFILE_CONTRACT_VERSION,
    profileId: bot.profileId,
    profileFingerprint: calibratedBotProfileFingerprint(bot),
    sourceRevision: "a".repeat(40),
    datasetDigest: `sha256:${"b".repeat(64)}`,
    runnerDigest: `sha256:${"c".repeat(64)}`,
    reproductionCommand: "npm run calibrate:bot -- --fixture manifest.json",
    games: 500,
    holdoutGames: 100,
    distinctRegisteredHumans: 100,
    estimatedRating: bot.fixedRating,
    standardError: 40,
    unresolvedAuditFindings: 0,
    coverage: [{ configurationKey: botConfigurationKey(configuration), games: 500 }],
    ...overrides,
  };
}

test("no bot profile can enter rated play without calibration evidence", () => {
  const bot = profile("bot:baseline:v1", 1500, 80);
  assert.deepEqual(evaluateBotCalibration(bot, null), {
    policyVersion: BOT_CALIBRATION_ACCEPTANCE_POLICY_VERSION,
    acceptedForRatedPlay: false,
    reasons: ["missing-evidence"],
  });
  assert.equal(selectNearestCalibratedBot(
    { globalRating: 1500, ratingDeviation: 100 },
    configuration,
    [{ profile: bot, evidence: null }],
    "even-only",
  ), null);
});

test("the acceptance gate requires reproducibility, sample size, coverage, precision, and audit closure", () => {
  const bot = profile("bot:gate:v1", 1500, 30);
  const decision = evaluateBotCalibration(bot, evidence(bot, {
    sourceRevision: "not-a-revision",
    games: 20,
    holdoutGames: 10,
    distinctRegisteredHumans: 4,
    standardError: 100,
    estimatedRating: 1900,
    unresolvedAuditFindings: 1,
    coverage: [],
  }));
  assert.equal(decision.acceptedForRatedPlay, false);
  assert.deepEqual(decision.reasons, [
    "invalid-reproducibility-evidence",
    "insufficient-games",
    "insufficient-holdout",
    "insufficient-human-opponents",
    "imprecise-estimate",
    "incomplete-configuration-coverage",
    "fixed-rating-not-supported",
    "fixed-deviation-understates-uncertainty",
    "unresolved-audit-findings",
  ]);
});

test("only exact profile and policy versions can consume evidence", () => {
  const bot = profile("bot:versioned:v1", 1500, 80);
  const mismatch = evaluateBotCalibration(bot, evidence(bot, {
    profileId: "bot:different:v1",
    acceptancePolicyVersion: "future-policy" as typeof BOT_CALIBRATION_ACCEPTANCE_POLICY_VERSION,
  }));
  assert.deepEqual(mismatch.reasons, ["profile-mismatch", "version-mismatch"]);
  assert.deepEqual(evaluateBotCalibration({
    ...bot,
    engineVersion: "engine-v2",
  }, evidence(bot)).reasons, ["profile-mismatch"]);
});

test("the calibration sample cannot claim impossible holdout or opponent counts", () => {
  const bot = profile("bot:sample:v1", 1500, 80);
  assert.deepEqual(evaluateBotCalibration(bot, evidence(bot, {
    holdoutGames: 501,
    distinctRegisteredHumans: 501,
  })).reasons, ["inconsistent-sample-counts"]);
});

test("a complete reproducible calibration artifact passes without activating a registry", () => {
  const bot = profile("bot:evidence:v1", 1500, 80);
  const decision = evaluateBotCalibration(bot, evidence(bot));
  assert.equal(decision.acceptedForRatedPlay, true);
  assert.deepEqual(decision.reasons, []);
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(decision.reasons), true);
});

test("configuration coverage is exact, unique, and reconciles to the game count", () => {
  const second = { ...configuration, boardSize: 13 as const };
  const bot = profile("bot:coverage:v1", 1500, 80, {
    supportedConfigurations: [configuration, second],
  });
  const valid = evidence(bot, {
    coverage: [
      { configurationKey: botConfigurationKey(configuration), games: 250 },
      { configurationKey: botConfigurationKey(second), games: 250 },
    ],
  });
  assert.equal(evaluateBotCalibration(bot, valid).acceptedForRatedPlay, true);
  assert.deepEqual(evaluateBotCalibration(bot, {
    ...valid,
    coverage: [{ configurationKey: botConfigurationKey(configuration), games: 500 }],
  }).reasons, ["incomplete-configuration-coverage"]);
});

test("nearest selection uses both rating and uncertainty and ignores inactive profiles", () => {
  const precise = profile("bot:precise:v1", 1500, 50);
  const uncertain = profile("bot:uncertain:v1", 1700, 200);
  const inactive = profile("bot:inactive:v1", 1600, 100);
  const selected = selectNearestCalibratedBot(
    { globalRating: 1600, ratingDeviation: 200 },
    configuration,
    [
      { profile: precise, evidence: evidence(precise) },
      { profile: inactive, evidence: null },
      { profile: uncertain, evidence: evidence(uncertain) },
    ],
    "even-only",
  );
  assert.equal(selected?.profile.profileId, uncertain.profileId);
  assert.equal(selected?.binding.opponentRating, 1700);
  assert.equal(selected?.binding.opponentRatingDeviation, 200);
  assert.equal(Object.isFrozen(selected), true);
  assert.equal(Object.isFrozen(selected?.profile), true);
});

test("bot rating and deviation are fixed profile credit, never mutable game state", () => {
  const bot = profile("bot:fixed:v1", 1625, 90);
  const binding = createBotOpponentBinding(bot, configuration);
  assert.equal(binding.opponentRating, 1625);
  assert.equal(binding.opponentRatingDeviation, 90);
  assert.equal(binding.creditMode, "fixed-versioned-profile");
  assert.match(binding.profileFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal("ratingAfter" in binding, false);
  assert.equal("ratingChange" in binding, false);
});

test("profile credit rejects a different engine, model, config, profile, or rating", () => {
  const bot = profile("bot:credit:v1", 1500, 80);
  const binding = createBotOpponentBinding(bot, configuration);
  const execution = {
    profileId: bot.profileId,
    engineFamily: bot.engineFamily,
    engineVersion: bot.engineVersion,
    modelVersion: bot.modelVersion,
    configVersion: bot.configVersion,
  };
  assert.equal(botExecutionMatchesBinding(binding, bot, execution), true);
  for (const changed of [
    { ...execution, profileId: "bot:other:v1" },
    { ...execution, engineVersion: "engine-v2" },
    { ...execution, modelVersion: "model-v2" },
    { ...execution, configVersion: "config-v2" },
  ]) {
    assert.equal(botExecutionMatchesBinding(binding, bot, changed), false);
  }
  assert.equal(botExecutionMatchesBinding(binding, {
    ...bot,
    fixedRating: 1600,
  }, execution), false);
});

test("human-only and registered-rated classifications never include bots", () => {
  assert.deepEqual(classifyCompetitiveActor("registered-human"), {
    isHuman: true,
    humanOnlyStatisticsEligible: true,
    registeredRatedPopulationEligible: true,
  });
  assert.deepEqual(classifyCompetitiveActor("guest-human"), {
    isHuman: true,
    humanOnlyStatisticsEligible: true,
    registeredRatedPopulationEligible: false,
  });
  assert.deepEqual(classifyCompetitiveActor("calibrated-bot"), {
    isHuman: false,
    humanOnlyStatisticsEligible: false,
    registeredRatedPopulationEligible: false,
  });
  assert.throws(
    () => classifyCompetitiveActor("unknown" as "registered-human"),
    RangeError,
  );
});

test("handicap profiles require verified non-zero configurations and explicit preference", () => {
  const handicapConfiguration = { ...configuration, handicap: 2 };
  const bot = profile("bot:handicap:v1", 1500, 80, {
    handicapMode: "verified-handicap",
    supportedConfigurations: [handicapConfiguration],
  });
  validateCalibratedBotProfile(bot);
  const calibrated = evidence(bot, {
    coverage: [{ configurationKey: botConfigurationKey(handicapConfiguration), games: 500 }],
  });
  assert.equal(selectNearestCalibratedBot(
    { globalRating: 1500, ratingDeviation: 100 },
    handicapConfiguration,
    [{ profile: bot, evidence: calibrated }],
    "even-only",
  ), null);
  assert.equal(selectNearestCalibratedBot(
    { globalRating: 1500, ratingDeviation: 100 },
    handicapConfiguration,
    [{ profile: bot, evidence: calibrated }],
    "verified-handicap-ok",
  )?.profile.profileId, bot.profileId);
});

test("malformed profiles fail closed before selection", () => {
  const base = profile("bot:valid:v1", 1500, 80);
  for (const malformed of [
    { ...base, profileId: "not-versioned" },
    { ...base, fixedRatingDeviation: 0 },
    { ...base, supportedConfigurations: [] },
    { ...base, transparentName: "" },
    { ...base, handicapMode: "automatic" as "even" },
  ]) {
    assert.throws(() => validateCalibratedBotProfile(malformed), RangeError);
  }
});
