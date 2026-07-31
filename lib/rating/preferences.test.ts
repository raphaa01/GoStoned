import assert from "node:assert/strict";
import test from "node:test";
import {
  initialRatingForStartingStrength,
  parseRatingDisplayPreference,
  parseRatingPreferences,
  parseStartingStrength,
  STARTING_STRENGTH_POLICY_VERSION,
} from "./preferences";

test("maps optional starting estimates to versioned high-uncertainty anchors", () => {
  assert.equal(STARTING_STRENGTH_POLICY_VERSION, "starting-strength-v1");
  for (const [estimate, expected] of [
    ["unspecified", 1200],
    ["new", 500],
    ["beginner", 900],
    ["intermediate", 1400],
    ["experienced", 1800],
  ] as const) {
    assert.equal(initialRatingForStartingStrength(parseStartingStrength(estimate, null)), expected);
  }
});

test("maps every supported known kyu/dan boundary through the shared v1 anchors", () => {
  assert.equal(initialRatingForStartingStrength(parseStartingStrength("known", "30k")), 500);
  assert.equal(initialRatingForStartingStrength(parseStartingStrength("known", "12K")), 1400);
  assert.equal(initialRatingForStartingStrength(parseStartingStrength("known", "1k")), 1950);
  assert.equal(initialRatingForStartingStrength(parseStartingStrength("known", "1d")), 2000);
  assert.equal(initialRatingForStartingStrength(parseStartingStrength("known", "9d")), 2800);
});

test("rejects ambiguous strength and preference payloads", () => {
  assert.throws(() => parseStartingStrength("known", null), /between 30k and 9d/);
  assert.throws(() => parseStartingStrength("beginner", "12k"), /only with/);
  assert.throws(() => parseStartingStrength("expert", null), /invalid/);
  assert.throws(() => parseStartingStrength("known", "10d"), /between 30k and 9d/);
  assert.equal(parseRatingDisplayPreference("both"), "both");
  assert.throws(() => parseRatingDisplayPreference("rank"), /invalid/);
  assert.deepEqual(parseRatingPreferences({
    displayPreference: "rank-primary",
    botMatchPreference: "calibrated-rated-after-wait",
  }), {
    displayPreference: "rank-primary",
    botMatchPreference: "calibrated-rated-after-wait",
  });
  assert.throws(() => parseRatingPreferences({
    displayPreference: "both",
    botMatchPreference: "always",
  }), /shape/);
  assert.throws(() => parseRatingPreferences({ displayPreference: "both" }), /shape/);
});
