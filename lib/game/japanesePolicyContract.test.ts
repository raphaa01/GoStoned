import assert from "node:assert/strict";
import test from "node:test";
import {
  JAPANESE_1989_CONTRACT_ID,
  JAPANESE_1989_POLICY_CONTRACT,
  JAPANESE_1989_RULES_PROFILE,
  JAPANESE_SETTLEMENT_PROPOSAL_DIGEST_VERSION,
  type Japanese1989ContractOutcome,
} from "./japanesePolicyContract";
import {
  DEFAULT_RULES_PROFILE,
  CURRENT_CHINESE_RULES_PROFILE,
  LEGACY_IMMEDIATE_AREA_PROFILE,
  resolveRulesPolicy,
  RULES_POLICIES,
  UnsupportedRulesPolicyError,
} from "./rulesPolicy";

test("documents the active Japanese rules semantics", () => {
  assert.deepEqual(JAPANESE_1989_POLICY_CONTRACT, {
    contractId: "japanese-1989-gostone-contract-v1",
    rulesProfile: "japanese-1989-gostone-v1",
    activation: "active",
    ruleset: "japanese",
    scoringMethod: "territory",
    scoringRule: "japanese-territory-with-prisoners",
    twoPassEffect: "stop",
    settlementRule: "mutual-life-death-and-territory-agreement",
    proposalDigest: {
      algorithm: "sha256",
      serializationVersion: "japanese-settlement-proposal-v1",
      includes: [
        "game-id",
        "stopped-board-hash",
        "stopped-move-number",
        "revision",
        "rules-identity",
        "prisoner-ledger",
        "sorted-dead-stones",
        "sorted-neutral-region-seeds",
      ],
    },
    automatedLifeDeathAdjudication: false,
    normalPlayKoRule: "simple-ko",
    koBanClearedBy: "prohibited-player-plays-elsewhere",
    passClearsNormalPlayKoBan: false,
    postStopLifeDeathKo: {
      recaptureRequires: "pass-for-the-specific-ko",
      passScope: "one-ko",
    },
    cyclicRepetitionRule: "mutual-no-result",
    cyclicRepetitionIsIllegalMove: false,
    resumeTurnRule: "opponent-first",
    matchConditions: {
      authority: "gostone-initial-conditions-outside-1989-rules",
      defaultKomi: 6.5,
      supportedKomi: [6.5],
      supportedHandicaps: [0],
    },
  });
  assert.equal(Object.isFrozen(JAPANESE_1989_POLICY_CONTRACT), true);
  assert.notEqual(JAPANESE_1989_CONTRACT_ID, JAPANESE_1989_RULES_PROFILE);
  assert.equal(
    JAPANESE_1989_POLICY_CONTRACT.proposalDigest.serializationVersion,
    JAPANESE_SETTLEMENT_PROPOSAL_DIGEST_VERSION,
  );
  assert.equal(Object.isFrozen(JAPANESE_1989_POLICY_CONTRACT.proposalDigest), true);
  assert.equal(Object.isFrozen(JAPANESE_1989_POLICY_CONTRACT.proposalDigest.includes), true);
  assert.equal(Object.isFrozen(JAPANESE_1989_POLICY_CONTRACT.postStopLifeDeathKo), true);
  assert.equal(Object.isFrozen(JAPANESE_1989_POLICY_CONTRACT.matchConditions), true);
  assert.equal(Object.isFrozen(JAPANESE_1989_POLICY_CONTRACT.matchConditions.supportedKomi), true);
  assert.equal(
    Object.isFrozen(JAPANESE_1989_POLICY_CONTRACT.matchConditions.supportedHandicaps),
    true,
  );
});

test("the rules profile resolves through the registry but the semantic contract id does not", () => {
  assert.deepEqual(Object.keys(RULES_POLICIES).sort(), [
    DEFAULT_RULES_PROFILE,
    CURRENT_CHINESE_RULES_PROFILE,
    LEGACY_IMMEDIATE_AREA_PROFILE,
  ].sort());
  assert.equal(Object.hasOwn(RULES_POLICIES, JAPANESE_1989_CONTRACT_ID), false);
  assert.equal(Object.hasOwn(RULES_POLICIES, JAPANESE_1989_RULES_PROFILE), true);
  assert.throws(
    () => resolveRulesPolicy(JAPANESE_1989_CONTRACT_ID),
    (error: unknown) => error instanceof UnsupportedRulesPolicyError
      && error.code === "unsupported_rules_profile",
  );
  assert.equal(resolveRulesPolicy(JAPANESE_1989_RULES_PROFILE).ruleset, "japanese");
});

function acceptOutcome(outcome: Japanese1989ContractOutcome): void {
  void outcome;
}

// @ts-expect-error point outcomes require a margin
acceptOutcome({ kind: "points", winner: "black" });
// @ts-expect-error jigo cannot name a winner
acceptOutcome({ kind: "jigo", winner: "white" });
// @ts-expect-error no-result requires its exact repetition reason
acceptOutcome({ kind: "no-result", reason: "timeout" });
// @ts-expect-error double-loss requires an Article 13 reason
acceptOutcome({ kind: "double-loss" });
// @ts-expect-error double-loss cannot accept an arbitrary reason
acceptOutcome({ kind: "double-loss", reason: "timeout" });
// @ts-expect-error forfeit requires a winner
acceptOutcome({ kind: "forfeit", reason: "rules-violation" });
// @ts-expect-error forfeit cannot accept an arbitrary reason
acceptOutcome({ kind: "forfeit", winner: "white", reason: "timeout" });

function outcomeLabel(outcome: Japanese1989ContractOutcome): string {
  switch (outcome.kind) {
    case "points":
      return `${outcome.winner}+${outcome.margin}`;
    case "jigo":
      return "jigo";
    case "resignation":
      return `${outcome.winner}+resignation`;
    case "no-result":
      return outcome.reason;
    case "double-loss":
      return outcome.reason;
    case "forfeit":
      return `${outcome.winner}+${outcome.reason}`;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

test("keeps every Japanese rules outcome semantically distinct and exhaustive", () => {
  const outcomes: Japanese1989ContractOutcome[] = [
    { kind: "points", winner: "black", margin: 0.5 },
    { kind: "jigo" },
    { kind: "resignation", winner: "white" },
    { kind: "no-result", reason: "cyclic-repetition" },
    {
      kind: "double-loss",
      reason: "post-stop-result-affecting-valid-move-deadlock",
    },
    { kind: "double-loss", reason: "unresolved-stone-displacement" },
    { kind: "forfeit", winner: "black", reason: "rules-violation" },
  ];
  assert.deepEqual(outcomes.map(outcomeLabel), [
    "black+0.5",
    "jigo",
    "white+resignation",
    "cyclic-repetition",
    "post-stop-result-affecting-valid-move-deadlock",
    "unresolved-stone-displacement",
    "black+rules-violation",
  ]);
});
