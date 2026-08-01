import assert from "node:assert/strict";
import test from "node:test";
import {
  decideJapaneseScoringDeadline,
  DEFAULT_JAPANESE_SCORING_DECISION_WINDOW_SECONDS,
  isJapaneseFinalResolutionPhase,
  japaneseScoringDecisionWindowSeconds,
  japaneseScoringResumptionsRemaining,
  MAX_JAPANESE_SCORING_RESUMPTIONS,
} from "./japaneseScoringLifecycle";

test("uses a bounded, server-configurable five-minute decision window", () => {
  assert.equal(
    japaneseScoringDecisionWindowSeconds(undefined),
    DEFAULT_JAPANESE_SCORING_DECISION_WINDOW_SECONDS,
  );
  assert.equal(japaneseScoringDecisionWindowSeconds("30"), 30);
  assert.equal(japaneseScoringDecisionWindowSeconds("3600"), 3600);
  for (const invalid of ["0", "29", "3601", "5.5", " 300", "nope"]) {
    assert.throws(() => japaneseScoringDecisionWindowSeconds(invalid));
  }
});

test("the scoring phase after three resumptions is the final resolution phase", () => {
  for (let count = 0; count < MAX_JAPANESE_SCORING_RESUMPTIONS; count += 1) {
    assert.equal(isJapaneseFinalResolutionPhase(count), false);
    assert.equal(
      japaneseScoringResumptionsRemaining(count),
      MAX_JAPANESE_SCORING_RESUMPTIONS - count,
    );
  }
  assert.equal(isJapaneseFinalResolutionPhase(3), true);
  assert.equal(isJapaneseFinalResolutionPhase(4), true);
  assert.equal(japaneseScoringResumptionsRemaining(3), 0);
  assert.throws(() => isJapaneseFinalResolutionPhase(-1));
  assert.throws(() => japaneseScoringResumptionsRemaining(0.5));
});

test("silence is never agreement at the scoring deadline", () => {
  assert.deepEqual(
    decideJapaneseScoringDeadline({
      blackParticipated: false,
      whiteParticipated: false,
    }),
    { kind: "no-result", reason: "no-participation" },
  );
  assert.deepEqual(
    decideJapaneseScoringDeadline({
      blackParticipated: true,
      whiteParticipated: false,
    }),
    { kind: "abandonment", abandonedBy: "white", winner: "black" },
  );
  assert.deepEqual(
    decideJapaneseScoringDeadline({
      blackParticipated: false,
      whiteParticipated: true,
    }),
    { kind: "abandonment", abandonedBy: "black", winner: "white" },
  );
  assert.deepEqual(
    decideJapaneseScoringDeadline({
      blackParticipated: true,
      whiteParticipated: true,
    }),
    {
      kind: "katago-adjudication",
      reason: "both-participated-without-agreement",
    },
  );
});
