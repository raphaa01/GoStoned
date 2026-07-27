import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advanceClock, restingClock } from "./goClock";

describe("Go clock", () => {
  it("counts down main time without consuming a period", () => {
    assert.deepEqual(
      advanceClock({
        mainTimeMs: 60_000,
        periodsRemaining: 5,
        periodTimeMs: 30_000,
        elapsedMs: 12_500,
      }),
      {
        mainTimeMs: 47_500,
        periodsRemaining: 5,
        displayTimeMs: 47_500,
        phase: "main",
        timedOut: false,
      },
    );
  });

  it("enters byo-yomi after main time", () => {
    const result = advanceClock({
      mainTimeMs: 5_000,
      periodsRemaining: 5,
      periodTimeMs: 30_000,
      elapsedMs: 12_000,
    });
    assert.equal(result.mainTimeMs, 0);
    assert.equal(result.periodsRemaining, 5);
    assert.equal(result.displayTimeMs, 23_000);
    assert.equal(result.phase, "byo-yomi");
    assert.equal(result.timedOut, false);
  });

  it("consumes complete byo-yomi periods", () => {
    const result = advanceClock({
      mainTimeMs: 0,
      periodsRemaining: 3,
      periodTimeMs: 20_000,
      elapsedMs: 25_000,
    });
    assert.equal(result.periodsRemaining, 2);
    assert.equal(result.displayTimeMs, 15_000);
    assert.equal(result.timedOut, false);
  });

  it("times out exactly when the final period expires", () => {
    const result = advanceClock({
      mainTimeMs: 0,
      periodsRemaining: 1,
      periodTimeMs: 20_000,
      elapsedMs: 20_000,
    });
    assert.equal(result.periodsRemaining, 0);
    assert.equal(result.displayTimeMs, 0);
    assert.equal(result.timedOut, true);
  });

  it("shows a full period for an idle player already in byo-yomi", () => {
    assert.deepEqual(restingClock(0, 2, 30_000), {
      mainTimeMs: 0,
      periodsRemaining: 2,
      displayTimeMs: 30_000,
      phase: "byo-yomi",
      timedOut: false,
    });
  });

  it("shows zero after the final period is gone", () => {
    assert.deepEqual(restingClock(0, 0, 30_000), {
      mainTimeMs: 0,
      periodsRemaining: 0,
      displayTimeMs: 0,
      phase: "byo-yomi",
      timedOut: true,
    });
  });
});
