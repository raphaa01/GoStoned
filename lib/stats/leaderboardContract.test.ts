import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicLeaderboardSnapshot } from "./leaderboardContract";

const now = Date.parse("2026-07-28T20:16:00.000Z");
const valid = {
  leaderboard: [
    { position: 1, playerName: "Calm Player", games: 12, wins: 7, rating: 1_280.5, ratingDeviation: 62.2 },
    { position: 2, playerName: "New Player", games: 10, wins: 4, rating: 1_184, ratingDeviation: 80 },
  ],
  observedAt: "2026-07-28T20:15:00.000Z",
};

test("public global leaderboard accepts only the narrow source-backed contract", () => {
  assert.deepEqual(parsePublicLeaderboardSnapshot(valid, now), valid);
  assert.deepEqual(parsePublicLeaderboardSnapshot({ ...valid, leaderboard: [] }, now), {
    ...valid,
    leaderboard: [],
  });
});

test("public global leaderboard rejects malformed entries", () => {
  for (const value of [
    null,
    { ...valid, leaderboard: null },
    { ...valid, leaderboard: [{ ...valid.leaderboard[0], position: 2 }] },
    { ...valid, leaderboard: [{ ...valid.leaderboard[0], games: 0 }] },
    { ...valid, leaderboard: [{ ...valid.leaderboard[0], wins: 13 }] },
    { ...valid, leaderboard: [{ ...valid.leaderboard[0], rating: Number.NaN }] },
    { ...valid, leaderboard: [{ ...valid.leaderboard[0], ratingDeviation: 0 }] },
  ]) assert.throws(() => parsePublicLeaderboardSnapshot(value, now));
});

test("public global leaderboard rejects invalid freshness", () => {
  for (const observedAt of [null, "not-a-date", "2026-07-28T20:15:00Z", "2026-07-28T20:21:00.001Z"]) {
    assert.throws(() => parsePublicLeaderboardSnapshot({ ...valid, observedAt }, now));
  }
});
