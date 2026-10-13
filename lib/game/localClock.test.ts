import assert from "node:assert/strict";
import test from "node:test";
import { createLocalClock, expireLocalClock, formatLocalClock, localClockReading, pauseLocalClock, resumeLocalClock, switchLocalClock } from "./localClock";

test("first tap starts Black, subsequent taps debit only the current color", () => {
  let clock = createLocalClock("blitz", 1000);
  assert.equal(localClockReading(clock, "black", 6000).displayTimeMs, 300000);
  clock = switchLocalClock(clock, 6000);
  assert.equal(clock.turn, "black");
  clock = switchLocalClock(clock, 8500);
  assert.equal(clock.turn, "white");
  assert.equal(clock.black.mainTimeMs, 297500);
  assert.equal(localClockReading(clock, "white", 9000).displayTimeMs, 299500);
  assert.equal(localClockReading(clock, "black", 9000).displayTimeMs, 297500);
});

test("pause preserves elapsed Byo-yomi, a completed turn restores its period", () => {
  let clock = createLocalClock("blitz", 0, true);
  clock = pauseLocalClock(clock, 312000);
  assert.equal(localClockReading(clock, "black", 400000).displayTimeMs, 8000);
  clock = resumeLocalClock(clock, 400000);
  assert.equal(localClockReading(clock, "black", 403000).displayTimeMs, 5000);
  clock = switchLocalClock(clock, 403000);
  assert.equal(clock.turn, "white");
  assert.equal(localClockReading(clock, "black", 403000).displayTimeMs, 20000);
  assert.equal(clock.black.periodsRemaining, 3);
});

test("background time consumes periods and timeout cannot be beaten by a late tap", () => {
  const clock = createLocalClock("blitz", 0, true);
  assert.equal(localClockReading(clock, "black", 340000).periodsRemaining, 1);
  const expired = switchLocalClock(clock, 360000);
  assert.equal(expired.winner, "white");
  assert.equal(expired.running, false);
  assert.equal(expired.turn, "black");
  assert.deepEqual(resumeLocalClock(expired, 400000), expired);
  assert.deepEqual(expireLocalClock(expired, 400000), expired);
  assert.equal(formatLocalClock(1), "0:01");
  assert.equal(formatLocalClock(0), "0:00");
});
