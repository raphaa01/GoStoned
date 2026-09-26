import assert from "node:assert/strict";
import test from "node:test";
import { GOSTONE_BOT_MODEL } from "@/lib/bot/modelV1";
import {
  applyTrainingAction,
  createTrainingPosition,
  kyuToBotRating,
  TRAINING_KYU_MAX,
  TRAINING_KYU_MIN,
} from "./trainingGame";

test("training kyu ranks map onto the browser model strength range", () => {
  assert.equal(kyuToBotRating(TRAINING_KYU_MIN), 2_100);
  assert.equal(kyuToBotRating(6), 1_800);
  assert.equal(kyuToBotRating(12), 1_500);
  assert.equal(kyuToBotRating(17), 1_200);
  assert.equal(kyuToBotRating(23), 900);
  assert.equal(kyuToBotRating(TRAINING_KYU_MAX), 600);
  assert.equal(GOSTONE_BOT_MODEL.rules, "japanese");
  assert.throws(() => kyuToBotRating(0), RangeError);
  assert.throws(() => kyuToBotRating(29), RangeError);
});

test("a local training position applies captures and ends play after two passes", () => {
  let position = createTrainingPosition(9);
  for (const action of [
    { kind: "play", x: 1, y: 0 },
    { kind: "play", x: 0, y: 0 },
    { kind: "play", x: 0, y: 1 },
    { kind: "pass" },
    { kind: "pass" },
  ] as const) {
    const result = applyTrainingAction(position, action, "2026-01-01T00:00:00.000Z");
    assert.equal(result.ok, true);
    if (result.ok) position = result.position;
  }

  assert.equal(position.board[0][0], null);
  assert.equal(position.prisoners.capturedWhiteByBlack, 1);
  assert.equal(position.consecutivePasses, 2);
  assert.equal(position.moves.length, 5);
});

test("training play rejects occupied intersections without changing the position", () => {
  const initial = createTrainingPosition(9);
  const first = applyTrainingAction(initial, { kind: "play", x: 4, y: 4 });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const occupied = applyTrainingAction(first.position, { kind: "play", x: 4, y: 4 });
  assert.deepEqual(occupied, { ok: false, error: "occupied" });
  assert.equal(first.position.moves.length, 1);
});
