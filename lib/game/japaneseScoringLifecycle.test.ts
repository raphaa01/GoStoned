import assert from "node:assert/strict";
import test from "node:test";
import {
  decideJapaneseScoringDeadline,
  isJapaneseFinalResolutionPhase,
  japaneseScoringDecisionWindowSeconds,
  japaneseScoringResumptionsRemaining,
  MAX_JAPANESE_SCORING_RESUMPTIONS,
} from "./japaneseScoringLifecycle";

test("uses a five-minute decision window with a bounded operations override", () => {
  assert.equal(japaneseScoringDecisionWindowSeconds(undefined), 300);
  assert.equal(japaneseScoringDecisionWindowSeconds("30"), 30);
  assert.equal(japaneseScoringDecisionWindowSeconds("3600"), 3600);
  for (const invalid of ["0", "29", "3601", "1.5", " 300", "unlimited"]) {
    assert.throws(() => japaneseScoringDecisionWindowSeconds(invalid));
  }
});

test("allows three dispute resumptions before the final-resolution phase", () => {
  assert.equal(MAX_JAPANESE_SCORING_RESUMPTIONS, 3);
  assert.deepEqual([0, 1, 2, 3, 4].map(japaneseScoringResumptionsRemaining), [3, 2, 1, 0, 0]);
  assert.deepEqual([0, 1, 2, 3, 4].map(isJapaneseFinalResolutionPhase), [false, false, false, true, true]);
  for (const invalid of [-1, 0.5, Number.NaN]) {
    assert.throws(() => japaneseScoringResumptionsRemaining(invalid));
    assert.throws(() => isJapaneseFinalResolutionPhase(invalid));
  }
});

test("deadline outcomes depend only on human participation, never model output", () => {
  assert.deepEqual(
    decideJapaneseScoringDeadline({ blackParticipated: false, whiteParticipated: false }),
    { kind: "no-result", reason: "no-participation" },
  );
  assert.deepEqual(
    decideJapaneseScoringDeadline({ blackParticipated: true, whiteParticipated: true }),
    { kind: "no-result", reason: "unresolved-after-participation" },
  );
  assert.deepEqual(
    decideJapaneseScoringDeadline({ blackParticipated: true, whiteParticipated: false }),
    { kind: "abandonment", abandonedBy: "white", winner: "black" },
  );
  assert.deepEqual(
    decideJapaneseScoringDeadline({ blackParticipated: false, whiteParticipated: true }),
    { kind: "abandonment", abandonedBy: "black", winner: "white" },
  );
});
