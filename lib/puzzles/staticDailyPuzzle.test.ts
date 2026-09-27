import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_LOCALES } from "@/lib/i18n/config";
import {
  DAILY_PUZZLE_CYCLE_LENGTH,
  DAILY_PUZZLE_CYCLE_START,
  dailyPuzzleAt,
} from "./dailyCatalog";
import {
  STATIC_DAILY_ENGINE_VERSION,
  staticDailyPuzzleForDate,
} from "./staticDailyPuzzle";

test("static daily records cover the fixed 40-day rotation without engine output", () => {
  const sourceIds = new Set<string>();
  for (let offset = 0; offset < DAILY_PUZZLE_CYCLE_LENGTH; offset += 1) {
    const date = new Date(`${DAILY_PUZZLE_CYCLE_START}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    const record = staticDailyPuzzleForDate(date.toISOString().slice(0, 10));
    assert.equal(record.cycleOrder, offset + 1);
    assert.equal(record.variation.mainLine.length, 1);
    assert.equal(record.variation.mainLine[0]?.move, record.solutionMove);
    assert.equal(record.variation.refutations.length, 0);
    assert.ok(record.acceptedMoves.length > 0);
    assert.ok(record.acceptedMoves.some((move) => move.move === record.solutionMove));
    assert.deepEqual(
      record.acceptedMoves.map(({ x, y }) => ({ x, y })),
      dailyPuzzleAt(record.cycleOrder).candidateMoves,
    );
    assert.equal(sourceIds.has(record.sourceId), false);
    sourceIds.add(record.sourceId);
    for (const locale of SUPPORTED_LOCALES) {
      assert.ok(record.explanation[locale]);
      assert.ok(record.variation.fallbackExplanation[locale]);
    }
  }
  assert.equal(sourceIds.size, DAILY_PUZZLE_CYCLE_LENGTH);
  assert.equal(STATIC_DAILY_ENGINE_VERSION, "static-daily-v2");
});

test("a new cycle date returns the same problem with a fresh daily date", () => {
  const first = staticDailyPuzzleForDate("2026-09-08");
  const repeated = staticDailyPuzzleForDate("2026-10-18");
  assert.equal(repeated.cycleOrder, 1);
  assert.equal(repeated.sourceId, first.sourceId);
  assert.equal(repeated.dailyDate, "2026-10-18");
  assert.notEqual(repeated.dailyDate, first.dailyDate);
});
