import assert from "node:assert/strict";
import test from "node:test";
import { advanceVisibleClock } from "./playerClock";

test("client clock crosses main time into a full first byo-yomi period", () => {
  assert.deepEqual(
    advanceVisibleClock({
      mainTimeMs: 5_000,
      periodsRemaining: 5,
      displayTimeMs: 5_000,
      phase: "main",
    }, 30_000, 12_000),
    {
      mainTimeMs: 0,
      periodsRemaining: 5,
      displayTimeMs: 23_000,
      phase: "byo-yomi",
    },
  );
});

test("client clock advances from a partially elapsed authoritative period", () => {
  assert.deepEqual(
    advanceVisibleClock({
      mainTimeMs: 0,
      periodsRemaining: 3,
      displayTimeMs: 12_000,
      phase: "byo-yomi",
    }, 30_000, 17_000),
    {
      mainTimeMs: 0,
      periodsRemaining: 2,
      displayTimeMs: 25_000,
      phase: "byo-yomi",
    },
  );
});

test("client clock reaches zero without inventing a game result", () => {
  assert.deepEqual(
    advanceVisibleClock({
      mainTimeMs: 0,
      periodsRemaining: 1,
      displayTimeMs: 8_000,
      phase: "byo-yomi",
    }, 30_000, 8_000),
    {
      mainTimeMs: 0,
      periodsRemaining: 0,
      displayTimeMs: 0,
      phase: "byo-yomi",
    },
  );
});

test("zero elapsed time preserves the server snapshot exactly", () => {
  const player = {
    mainTimeMs: 0,
    periodsRemaining: 2,
    displayTimeMs: 19_250,
    phase: "byo-yomi" as const,
  };
  assert.equal(advanceVisibleClock(player, 30_000, 0), player);
});
