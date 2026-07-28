import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MATCH_RULES,
  DEFAULT_RULES_PROFILE,
  LEGACY_IMMEDIATE_AREA_PROFILE,
  resolveRulesConfiguration,
  resolveRulesPolicy,
  resolveScoringConfiguration,
  RULES_POLICIES,
  sameRulesConfiguration,
  UnsupportedRulesPolicyError,
} from "./rulesPolicy";

function stored(overrides: Partial<{
  ruleset: unknown;
  rulesProfile: unknown;
  scoringMethod: unknown;
  komi: unknown;
  handicap: unknown;
}> = {}) {
  return {
    ruleset: "chinese",
    rulesProfile: DEFAULT_RULES_PROFILE,
    scoringMethod: "area",
    komi: 7.5,
    handicap: 0,
    ...overrides,
  };
}

function assertPolicyError(
  callback: () => unknown,
  code: UnsupportedRulesPolicyError["code"],
) {
  assert.throws(callback, (error: unknown) =>
    error instanceof UnsupportedRulesPolicyError && error.code === code,
  );
}

test("registers exactly the two persisted Chinese profiles without a fallback", () => {
  assert.deepEqual(Object.keys(RULES_POLICIES).sort(), [
    DEFAULT_RULES_PROFILE,
    LEGACY_IMMEDIATE_AREA_PROFILE,
  ].sort());
  assert.equal(resolveRulesPolicy(DEFAULT_RULES_PROFILE).scoringLifecycle, "agreement");
  assert.equal(resolveRulesPolicy(LEGACY_IMMEDIATE_AREA_PROFILE).scoringLifecycle, "immediate");
  assert.equal(resolveRulesPolicy(DEFAULT_RULES_PROFILE).turnSource, "persisted");
  assert.equal(resolveRulesPolicy(LEGACY_IMMEDIATE_AREA_PROFILE).turnSource, "move-log");
  assert.equal(resolveRulesPolicy(DEFAULT_RULES_PROFILE).scoringResponseWindowMs, 600_000);
  assert.equal(resolveRulesPolicy(LEGACY_IMMEDIATE_AREA_PROFILE).scoringResponseWindowMs, null);
  assert.equal(resolveRulesPolicy(DEFAULT_RULES_PROFILE).resumeTurnRule, "claim-dependent");
  assert.equal(resolveRulesPolicy(LEGACY_IMMEDIATE_AREA_PROFILE).resumeTurnRule, "none");
  assert.equal(Object.isFrozen(RULES_POLICIES), true);
  for (const [profile, policy] of Object.entries(RULES_POLICIES)) {
    assert.equal(policy.profile, profile);
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Object.isFrozen(policy.supportedKomi), true);
    assert.equal(Object.isFrozen(policy.supportedHandicaps), true);
  }
});

test("keeps new matches on the explicit current Chinese policy", () => {
  assert.deepEqual(DEFAULT_MATCH_RULES, {
    ruleset: "chinese",
    rulesProfile: "chinese-2002-gostone-v1",
    scoringMethod: "area",
    komi: 7.5,
    handicap: 0,
  });
  assert.equal(Object.isFrozen(DEFAULT_MATCH_RULES), true);
});

test("preserves stored legacy komi and parses PostgreSQL numeric strings", () => {
  const legacySixPointFive = resolveRulesConfiguration(stored({
    rulesProfile: LEGACY_IMMEDIATE_AREA_PROFILE,
    komi: "6.5",
  }));
  const legacySevenPointFive = resolveRulesConfiguration(stored({
    rulesProfile: LEGACY_IMMEDIATE_AREA_PROFILE,
    komi: "7.5",
  }));
  assert.equal(legacySixPointFive.komi, 6.5);
  assert.equal(legacySevenPointFive.komi, 7.5);
  assert.equal(legacySixPointFive.policy.profile, LEGACY_IMMEDIATE_AREA_PROFILE);
  assert.equal(Object.isFrozen(legacySixPointFive), true);
});

test("rejects unknown, missing, and future profiles instead of selecting Chinese behavior", () => {
  for (const rulesProfile of [
    "",
    null,
    undefined,
    {},
    "japanese-1989-gostone-v1",
    "chinese-2002-gostone-v2",
  ]) {
    assertPolicyError(
      () => resolveRulesConfiguration(stored({ rulesProfile })),
      "unsupported_rules_profile",
    );
  }
});

test("rejects every ruleset and scoring-method mismatch", () => {
  assertPolicyError(
    () => resolveRulesConfiguration(stored({ ruleset: "japanese" })),
    "rules_policy_mismatch",
  );
  assertPolicyError(
    () => resolveRulesConfiguration(stored({ scoringMethod: "territory" })),
    "rules_policy_mismatch",
  );
  assertPolicyError(
    () => resolveRulesConfiguration(stored({
      rulesProfile: LEGACY_IMMEDIATE_AREA_PROFILE,
      ruleset: "japanese",
    })),
    "rules_policy_mismatch",
  );
});

test("rejects malformed komi and values outside each profile's exact historical set", () => {
  for (const komi of [
    NaN,
    Infinity,
    -Infinity,
    "",
    "seven",
    "0x10",
    "1e1",
    7.25,
    6.5,
    0.5,
    -999.5,
    null,
  ]) {
    assertPolicyError(
      () => resolveRulesConfiguration(stored({ komi })),
      "invalid_rules_komi",
    );
  }
  for (const komi of [0.5, 5.5, 8.5]) {
    assertPolicyError(
      () => resolveRulesConfiguration(stored({
        rulesProfile: LEGACY_IMMEDIATE_AREA_PROFILE,
        komi,
      })),
      "invalid_rules_komi",
    );
  }
});

test("rejects every handicap not supported by the profile", () => {
  for (const handicap of [1, -1, 0.5, "0", null]) {
    assertPolicyError(
      () => resolveRulesConfiguration(stored({ handicap })),
      "unsupported_rules_handicap",
    );
  }
});

test("compares the complete persisted tuple including komi and handicap", () => {
  const current = resolveRulesConfiguration(stored());
  const same = resolveRulesConfiguration(stored({ komi: "7.5" }));
  const legacy = resolveRulesConfiguration(stored({ rulesProfile: LEGACY_IMMEDIATE_AREA_PROFILE }));
  const differentKomi = { ...current, komi: 6.5 };
  assert.equal(sameRulesConfiguration(current, same), true);
  assert.equal(sameRulesConfiguration(current, legacy), false);
  assert.equal(sameRulesConfiguration(current, differentKomi), false);
});

test("accepts only an exact agreement-scoring snapshot for the parent game", () => {
  const current = resolveRulesConfiguration(stored());
  assert.equal(resolveScoringConfiguration(current, stored()).policy.scoringLifecycle, "agreement");
  for (const snapshot of [
    stored({ rulesProfile: LEGACY_IMMEDIATE_AREA_PROFILE }),
    stored({ komi: 6.5 }),
    stored({ scoringMethod: "territory" }),
    stored({ rulesProfile: "japanese-1989-gostone-v1" }),
  ]) {
    assert.throws(
      () => resolveScoringConfiguration(current, snapshot),
      UnsupportedRulesPolicyError,
    );
  }
  const legacy = resolveRulesConfiguration(stored({
    rulesProfile: LEGACY_IMMEDIATE_AREA_PROFILE,
    komi: 6.5,
  }));
  assertPolicyError(
    () => resolveScoringConfiguration(legacy, stored({
      rulesProfile: LEGACY_IMMEDIATE_AREA_PROFILE,
      komi: 6.5,
    })),
    "rules_policy_mismatch",
  );
});
