import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicLeaderboardSnapshot } from "./leaderboardContract";

const now = Date.parse("2026-07-28T20:16:00.000Z");
const valid = {
  boardSize: 19,
  leaderboard: [
    { position: 1, playerName: "Calm Player", games: 12, wins: 7, rating: 1_280 },
    { position: 2, playerName: "New Player", games: 1, wins: 0, rating: 1_184 },
  ],
  observedAt: "2026-07-28T20:15:00.000Z",
};

test("public leaderboard snapshots accept only the expected narrow contract", () => {
  assert.deepEqual(parsePublicLeaderboardSnapshot(valid, 19, now), valid);
  assert.deepEqual(
    parsePublicLeaderboardSnapshot({ ...valid, leaderboard: [] }, 19, now),
    { ...valid, leaderboard: [] },
  );
});

test("public leaderboard snapshots reject malformed collections and rankings", () => {
  const invalid: unknown[] = [
    null,
    { ...valid, boardSize: 9 },
    { ...valid, leaderboard: null },
    { ...valid, leaderboard: Array.from({ length: 101 }, (_, index) => ({
      position: index + 1,
      playerName: `Player ${index}`,
      games: 1,
      wins: 0,
      rating: 1_200,
    })) },
    { ...valid, leaderboard: [{ ...valid.leaderboard[0], position: 2 }] },
    { ...valid, leaderboard: [{ ...valid.leaderboard[0], position: 1.5 }] },
    { ...valid, leaderboard: [{ ...valid.leaderboard[0], playerName: "" }] },
    { ...valid, leaderboard: [{ ...valid.leaderboard[0], playerName: "x".repeat(81) }] },
    { ...valid, leaderboard: [{ ...valid.leaderboard[0], games: 0 }] },
    { ...valid, leaderboard: [{ ...valid.leaderboard[0], wins: 13 }] },
    { ...valid, leaderboard: [{ ...valid.leaderboard[0], rating: 99 }] },
  ];

  for (const value of invalid) {
    assert.throws(() => parsePublicLeaderboardSnapshot(value, 19, now));
  }
});

test("public leaderboard snapshots reject invalid and implausibly future freshness", () => {
  for (const observedAt of [
    null,
    "not-a-date",
    "2026-07-28T20:15:00Z",
    "2026-07-28T20:21:00.001Z",
  ]) {
    assert.throws(() => parsePublicLeaderboardSnapshot({ ...valid, observedAt }, 19, now));
  }
  assert.equal(
    parsePublicLeaderboardSnapshot(
      { ...valid, observedAt: "2026-07-28T20:21:00.000Z" },
      19,
      now,
    ).observedAt,
    "2026-07-28T20:21:00.000Z",
  );
});
