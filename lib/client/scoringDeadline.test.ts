import assert from "node:assert/strict";
import test from "node:test";
import {
  formatScoringCountdown,
  scoringDeadlineRemainingMs,
} from "./scoringDeadline";

test("anchors the decision countdown to server time instead of browser wall time", () => {
  assert.equal(scoringDeadlineRemainingMs(
    "2026-08-01T10:05:00.000Z",
    {
      serverNow: "2026-08-01T10:00:00.000Z",
      clientReceivedAt: 20_000,
    },
    21_500,
  ), 298_500);
});

test("clamps expired and malformed deadlines without producing negative time", () => {
  assert.equal(scoringDeadlineRemainingMs(
    "2026-08-01T10:00:00.000Z",
    { serverNow: "2026-08-01T10:00:01.000Z", clientReceivedAt: 1_000 },
    4_000,
  ), 0);
  assert.equal(scoringDeadlineRemainingMs(
    "not-a-date",
    { serverNow: "2026-08-01T10:00:00.000Z" },
  ), 0);
});

test("formats a stable visible minutes-and-seconds countdown", () => {
  assert.equal(formatScoringCountdown(300_000), "5:00");
  assert.equal(formatScoringCountdown(60_001), "1:01");
  assert.equal(formatScoringCountdown(1), "0:01");
  assert.equal(formatScoringCountdown(0), "0:00");
});
