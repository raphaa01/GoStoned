import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RATING_DISPLAY_PREFERENCE,
  deriveGoRank,
  formatGoRank,
  presentRating,
  RANK_CONVERSION_POLICY_VERSION,
} from "./rankPolicy";

test("honors the v1 calibration anchors and clamps the supported rank range", () => {
  assert.deepEqual(deriveGoRank(500), {
    kind: "kyu",
    value: 30,
    policyVersion: RANK_CONVERSION_POLICY_VERSION,
  });
  assert.equal(deriveGoRank(1950).value, 1);
  assert.deepEqual(deriveGoRank(2000), {
    kind: "dan",
    value: 1,
    policyVersion: RANK_CONVERSION_POLICY_VERSION,
  });
  assert.deepEqual(deriveGoRank(2800), {
    kind: "dan",
    value: 9,
    policyVersion: RANK_CONVERSION_POLICY_VERSION,
  });
  assert.deepEqual(deriveGoRank(-10_000), {
    kind: "kyu",
    value: 30,
    policyVersion: RANK_CONVERSION_POLICY_VERSION,
  });
  assert.deepEqual(deriveGoRank(10_000), {
    kind: "dan",
    value: 9,
    policyVersion: RANK_CONVERSION_POLICY_VERSION,
  });
});

test("uses deterministic kyu and dan boundaries", () => {
  assert.deepEqual(deriveGoRank(1342), {
    kind: "kyu",
    value: 14,
    policyVersion: RANK_CONVERSION_POLICY_VERSION,
  });
  assert.equal(deriveGoRank(1949.999).value, 2);
  assert.equal(deriveGoRank(1950).value, 1);
  assert.equal(deriveGoRank(1999.999).value, 1);
  assert.deepEqual(deriveGoRank(2099.999), {
    kind: "dan",
    value: 1,
    policyVersion: RANK_CONVERSION_POLICY_VERSION,
  });
  assert.deepEqual(deriveGoRank(2100), {
    kind: "dan",
    value: 2,
    policyVersion: RANK_CONVERSION_POLICY_VERSION,
  });
});

test("formats English and German Go notation centrally", () => {
  assert.equal(formatGoRank(deriveGoRank(1950), "en"), "1 kyu");
  assert.equal(formatGoRank(deriveGoRank(2000), "en"), "1 dan");
  assert.equal(formatGoRank(deriveGoRank(1950), "de"), "1. Kyu");
  assert.equal(formatGoRank(deriveGoRank(2000), "de"), "1. Dan");
});

test("builds all three display preferences from one conversion", () => {
  const both = presentRating(1342);
  assert.equal(DEFAULT_RATING_DISPLAY_PREFERENCE, "both");
  assert.equal(both.primaryLabel, "14 kyu · 1342");
  assert.equal(both.secondaryLabel, null);
  assert.equal(both.combinedLabel, "14 kyu · 1342");

  const rankPrimary = presentRating(1342, "rank-primary", "en");
  assert.equal(rankPrimary.primaryLabel, "14 kyu");
  assert.equal(rankPrimary.secondaryLabel, "1342");
  assert.equal(rankPrimary.combinedLabel, both.combinedLabel);

  const ratingPrimary = presentRating(1342, "rating-primary", "de");
  assert.equal(ratingPrimary.primaryLabel, "1342");
  assert.equal(ratingPrimary.secondaryLabel, "14. Kyu");
  assert.equal(ratingPrimary.combinedLabel, "14. Kyu · 1342");
});

test("rounds only the numerical display and rejects non-finite ratings", () => {
  const presentation = presentRating(1999.6);
  assert.equal(presentation.rankLabel, "1 kyu");
  assert.equal(presentation.numericLabel, "2000");
  assert.throws(() => deriveGoRank(Number.NaN), /Rating must be finite/);
  assert.throws(() => presentRating(Number.POSITIVE_INFINITY), /Rating must be finite/);
  assert.throws(() => formatGoRank({ kind: "dan", value: 10 }, "en"), /between 1 and 9/);
  assert.throws(
    () => formatGoRank({ kind: "kyu", value: 1 }, "fr" as "en"),
    /locale is invalid/,
  );
});
