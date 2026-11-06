import assert from "node:assert/strict";
import test from "node:test";
import {
  finalMonthlyStandings,
  monthlyWindow,
  parseTournamentSettings,
  rankStandings,
  roundRobin,
  tournamentCategory,
} from "./tournaments/policy";

test("monthly window includes exactly the last seven calendar days, including leap years", () => {
  for (const [date, start, end] of [
    ["2026-11-05", "2026-11-24T00:00:00.000Z", "2026-12-01T00:00:00.000Z"],
    ["2028-02-01", "2028-02-23T00:00:00.000Z", "2028-03-01T00:00:00.000Z"],
    ["2027-02-28", "2027-02-22T00:00:00.000Z", "2027-03-01T00:00:00.000Z"],
    ["2026-12-31", "2026-12-25T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
  ]) {
    const window = monthlyWindow(new Date(date));
    assert.equal(window.startsAt.toISOString(), start);
    assert.equal(window.endsAt.toISOString(), end);
    assert.equal(
      window.endsAt.getTime() - window.startsAt.getTime(),
      7 * 86400000,
    );
  }
});
test("category boundaries follow GoStone global rating bands", () => {
  assert.deepEqual(
    [500, 999, 1000, 1499, 1500, 1999, 2000, 2400].map(tournamentCategory),
    [0, 0, 1, 1, 2, 2, 3, 3],
  );
});
test("every supported private lobby produces unique opponents and at most one game per round", () => {
  for (let n = 2; n <= 32; n++) {
    const ids = Array.from({ length: n }, (_, i) => String(i));
    const rounds = roundRobin(ids);
    const seen = new Set<string>();
    for (const round of rounds) {
      const active = new Set<string>();
      for (const [black, white] of round) {
        assert(!active.has(black));
        active.add(black);
        if (white === null) continue;
        assert(!active.has(white));
        active.add(white);
        const pairing = [black, white].sort().join(":");
        assert(!seen.has(pairing));
        seen.add(pairing);
      }
      assert.equal(active.size, n);
    }
    assert.equal(seen.size, (n * (n - 1)) / 2);
  }
});
test("exact ties share a place; opponent points and wins break other ties", () => {
  const row = { name: "Player", rating: 1200, losses: 0, draws: 0, played: 5 };
  const result = rankStandings([
    { ...row, userId: "a", points: 4, tiebreak: 10, wins: 4 },
    { ...row, userId: "b", points: 4, tiebreak: 11, wins: 4 },
    { ...row, userId: "c", points: 4, tiebreak: 11, wins: 4 },
    { ...row, userId: "d", points: 3, tiebreak: 20, wins: 3 },
  ]);
  assert.deepEqual(
    result.map((r) => [r.userId, r.place]),
    [
      ["b", 1],
      ["c", 1],
      ["a", 3],
      ["d", 4],
    ],
  );
});
test("host settings reject unsupported formats, oversized lobbies and hidden controls", () => {
  const valid = {
    name: "Club",
    boardSize: 13,
    timeControl: "rapid",
    maxPlayers: 8,
    format: "round_robin",
  };
  assert.equal(parseTournamentSettings(valid).name, "Club");
  for (const bad of [
    { maxPlayers: 33 },
    { maxPlayers: 2.5 },
    { format: "swiss" },
    { boardSize: 15 },
    { timeControl: "custom" },
    { name: "\u202EClub" },
    { name: " " },
  ]) {
    assert.throws(() => parseTournamentSettings({ ...valid, ...bad }));
  }
});

test("monthly final places match podium qualification even when an incomplete run has more points", () => {
  const common = {
    name: "Player",
    rating: 1200,
    losses: 0,
    draws: 0,
    tiebreak: 0,
    place: 1,
  };
  const ranked = finalMonthlyStandings([
    { ...common, userId: "partial", points: 4, wins: 4, played: 4 },
    { ...common, userId: "complete", points: 3, wins: 3, played: 5 },
  ]);
  assert.deepEqual(
    ranked.map((r) => [r.userId, r.place]),
    [
      ["complete", 1],
      ["partial", 2],
    ],
  );
});
