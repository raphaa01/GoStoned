import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTIVE_MATCH_POLICY_VERSION,
  evaluateAdaptiveMatch,
  rankAdaptiveMatchCandidates,
  type AdaptiveMatchEntry,
  type ExactMatchConfiguration,
  type RegisteredMatchEntry,
} from "./adaptiveMatchPolicy";

const now = 1_800_000;
const configuration: ExactMatchConfiguration = Object.freeze({
  boardSize: 19,
  timeControl: "rapid",
  rules: "japanese",
  rulesProfile: "japanese-1989-gostone-v1",
  rulesVersion: "japanese-1989-gostone-contract-v1",
  scoringMethod: "territory",
  komi: 6.5,
  handicap: 0,
});

function registered(
  playerKey: string,
  overrides: Partial<RegisteredMatchEntry> = {},
): RegisteredMatchEntry {
  return {
    playerKey,
    pool: "registered-rated",
    configuration,
    waitingSinceMs: now,
    reliableLatencyMs: null,
    abandonmentRisk: "normal",
    handicapPreference: "even-only",
    globalRating: 1500,
    ratingDeviation: 80,
    ...overrides,
  };
}

test("adaptive matching is versioned, symmetric, and immutable", () => {
  const left = registered("user:left", { globalRating: 1490, reliableLatencyMs: 40 });
  const right = registered("user:right", { globalRating: 1510, reliableLatencyMs: 60 });
  const context = { nowMs: now, blockedEitherDirection: false };
  const forward = evaluateAdaptiveMatch(left, right, context);
  const reverse = evaluateAdaptiveMatch(right, left, context);
  assert.equal(forward.policyVersion, ADAPTIVE_MATCH_POLICY_VERSION);
  assert.equal(forward.eligible, true);
  assert.equal(forward.score, reverse.score);
  assert.deepEqual(forward.components, reverse.components);
  assert.equal(Object.isFrozen(forward), true);
  assert.equal(Object.isFrozen(forward.components), true);
  assert.equal(Object.isFrozen(forward.reasons), true);
});

test("guest and registered pools remain strictly distinct", () => {
  const account = registered("user:account");
  const guest: AdaptiveMatchEntry = {
    playerKey: "guest:visitor",
    pool: "guest-unrated",
    configuration,
    waitingSinceMs: now,
    reliableLatencyMs: null,
    abandonmentRisk: "normal",
    handicapPreference: "even-only",
    globalRating: null,
    ratingDeviation: null,
  };
  const evaluation = evaluateAdaptiveMatch(account, guest, {
    nowMs: now,
    blockedEitherDirection: false,
  });
  assert.equal(evaluation.eligible, false);
  assert.deepEqual(evaluation.reasons, ["pool-mismatch"]);
  assert.equal(evaluation.ratingGap, null);
  assert.throws(
    () => evaluateAdaptiveMatch(account, {
      ...guest,
      globalRating: 1500,
    } as unknown as AdaptiveMatchEntry, { nowMs: now, blockedEitherDirection: false }),
    /Guest matchmaking cannot carry rated-player state/,
  );
});

test("board, time, and every persisted rules field are exact pool boundaries", async (t) => {
  const left = registered("user:left");
  for (const [field, value] of [
    ["boardSize", 13],
    ["timeControl", "classic"],
    ["rules", "chinese"],
    ["rulesProfile", "another-profile"],
    ["rulesVersion", "another-version"],
    ["scoringMethod", "area"],
    ["komi", 7.5],
    ["handicap", 2],
  ] as const) {
    await t.test(field, () => {
      const right = registered("user:right", {
        configuration: { ...configuration, [field]: value },
      });
      assert.deepEqual(
        evaluateAdaptiveMatch(left, right, {
          nowMs: now,
          blockedEitherDirection: false,
        }).reasons,
        ["configuration-mismatch"],
      );
    });
  }
});

test("wait duration widens the rating window only to its documented cap", () => {
  const left = registered("user:left", { globalRating: 1500, ratingDeviation: 30 });
  const fresh = registered("user:fresh", { globalRating: 1900, ratingDeviation: 30 });
  const immediate = evaluateAdaptiveMatch(left, fresh, {
    nowMs: now,
    blockedEitherDirection: false,
  });
  assert.equal(immediate.eligible, false);
  assert.deepEqual(immediate.reasons, ["rating-window"]);

  const waited = evaluateAdaptiveMatch(
    { ...left, waitingSinceMs: now - 30 * 60_000 },
    fresh,
    { nowMs: now, blockedEitherDirection: false },
  );
  assert.equal(waited.eligible, true);
  assert.equal(waited.ratingWindow, 500);
  assert.ok(waited.components.waitPriority > immediate.components.waitPriority);
});

test("rating uncertainty expands compatibility without becoming a second rating", () => {
  const lowUncertainty = evaluateAdaptiveMatch(
    registered("user:left", { ratingDeviation: 20 }),
    registered("user:right", { globalRating: 1700, ratingDeviation: 20 }),
    { nowMs: now, blockedEitherDirection: false },
  );
  const highUncertainty = evaluateAdaptiveMatch(
    registered("user:left", { ratingDeviation: 200 }),
    registered("user:right", { globalRating: 1700, ratingDeviation: 200 }),
    { nowMs: now, blockedEitherDirection: false },
  );
  assert.equal(lowUncertainty.eligible, false);
  assert.equal(highUncertainty.eligible, true);
  assert.equal(highUncertainty.uncertaintyAllowance, 140);
});

test("latency is advisory only when both inputs are explicitly reliable", () => {
  const left = registered("user:left", { reliableLatencyMs: 30 });
  const unknown = evaluateAdaptiveMatch(left, registered("user:unknown"), {
    nowMs: now,
    blockedEitherDirection: false,
  });
  const nearby = evaluateAdaptiveMatch(left, registered("user:near", {
    reliableLatencyMs: 40,
  }), { nowMs: now, blockedEitherDirection: false });
  const remote = evaluateAdaptiveMatch(left, registered("user:remote", {
    reliableLatencyMs: 700,
  }), { nowMs: now, blockedEitherDirection: false });
  assert.equal(unknown.eligible, true);
  assert.equal(unknown.components.latencyQuality, 0.5);
  assert.ok(nearby.components.latencyQuality > unknown.components.latencyQuality);
  assert.ok(remote.components.latencyQuality < unknown.components.latencyQuality);
});

test("blocks and restricted abandonment risk are hard exclusions", () => {
  const left = registered("user:left");
  const right = registered("user:right");
  assert.deepEqual(evaluateAdaptiveMatch(left, right, {
    nowMs: now,
    blockedEitherDirection: true,
  }).reasons, ["blocked"]);
  assert.deepEqual(evaluateAdaptiveMatch(left, {
    ...right,
    abandonmentRisk: "restricted",
  }, {
    nowMs: now,
    blockedEitherDirection: false,
  }).reasons, ["restricted-abandonment-risk"]);
  const elevated = evaluateAdaptiveMatch(left, {
    ...right,
    abandonmentRisk: "elevated",
  }, { nowMs: now, blockedEitherDirection: false });
  assert.equal(elevated.eligible, true);
  assert.equal(elevated.components.abandonmentQuality, 0.75);
});

test("handicap preference can recommend review but never invents a handicap game", () => {
  const evaluation = evaluateAdaptiveMatch(
    registered("user:left", {
      globalRating: 1500,
      waitingSinceMs: now - 30 * 60_000,
      handicapPreference: "verified-handicap-ok",
    }),
    registered("user:right", {
      globalRating: 1750,
      handicapPreference: "verified-handicap-ok",
    }),
    { nowMs: now, blockedEitherDirection: false },
  );
  assert.equal(evaluation.eligible, true);
  assert.equal(evaluation.recommendedGame, "verified-handicap-review");
  assert.equal(evaluation.components.handicapCompatibility, 1);
});

test("candidate ranking is deterministic and keeps ineligible candidates last", () => {
  const requester = registered("user:requester");
  const candidates = [
    registered("user:blocked", { globalRating: 1500 }),
    registered("user:worse", { globalRating: 1580 }),
    registered("user:best", { globalRating: 1510 }),
  ];
  const ranked = rankAdaptiveMatchCandidates(
    requester,
    candidates,
    (candidate) => ({
      nowMs: now,
      blockedEitherDirection: candidate.playerKey === "user:blocked",
    }),
  );
  assert.deepEqual(ranked.map(({ candidate }) => candidate.playerKey), [
    "user:best",
    "user:worse",
    "user:blocked",
  ]);
  assert.equal(Object.isFrozen(ranked), true);
});

test("invalid temporal, rating, uncertainty, and latency inputs fail closed", () => {
  const right = registered("user:right");
  for (const left of [
    registered("user:left", { waitingSinceMs: now + 1 }),
    registered("user:left", { globalRating: Number.NaN }),
    registered("user:left", { ratingDeviation: 0 }),
    registered("user:left", { reliableLatencyMs: 2_001 }),
  ]) {
    assert.throws(() => evaluateAdaptiveMatch(left, right, {
      nowMs: now,
      blockedEitherDirection: false,
    }), RangeError);
  }
  for (const left of [
    registered("user:left", { pool: "invented" as "registered-rated" }),
    registered("user:left", { abandonmentRisk: "unknown" as "normal" }),
    registered("user:left", { handicapPreference: "automatic" as "even-only" }),
  ]) {
    assert.throws(() => evaluateAdaptiveMatch(left, right, {
      nowMs: now,
      blockedEitherDirection: false,
    }), RangeError);
  }
  assert.throws(() => evaluateAdaptiveMatch(registered("user:left"), right, {
    nowMs: now,
    blockedEitherDirection: null as unknown as boolean,
  }), RangeError);
});
