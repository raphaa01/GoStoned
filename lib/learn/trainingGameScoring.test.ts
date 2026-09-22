import assert from "node:assert/strict";
import test from "node:test";
import { GOSTONE_BOT_MODEL } from "@/lib/bot/modelV1";
import { applyTrainingAction, createTrainingPosition } from "./trainingGame";
import { scoreTrainingSettlement } from "./trainingGameScoring";

test("training settlement is replayed and scored without persistence", () => {
  let position = createTrainingPosition(9);
  for (const action of [{ kind: "pass" }, { kind: "pass" }] as const) {
    const result = applyTrainingAction(position, action, "2026-01-01T00:00:00.000Z");
    assert.equal(result.ok, true);
    if (result.ok) position = result.position;
  }

  const result = scoreTrainingSettlement({
    boardSize: 9,
    moves: position.moves,
    proposal: {
      contractVersion: "gostone-japanese-settlement-v1",
      authority: "proposal-only",
      modelVersion: GOSTONE_BOT_MODEL.modelVersion,
      modelSha256: GOSTONE_BOT_MODEL.artifactSha256,
      stoppedMoveNumber: 2,
      deadStones: [],
      uncertainStones: [],
      neutralRegionSeeds: [],
    },
  });

  assert.equal(result.modelName, GOSTONE_BOT_MODEL.modelName);
  assert.equal(result.score.whiteTotal, GOSTONE_BOT_MODEL.komi);
  assert.deepEqual(result.score.outcome, {
    kind: "points",
    winner: "white",
    margin: GOSTONE_BOT_MODEL.komi,
  });
});

test("training settlement refuses uncertain model proposals", () => {
  let position = createTrainingPosition(9);
  for (const action of [{ kind: "pass" }, { kind: "pass" }] as const) {
    const result = applyTrainingAction(position, action);
    if (result.ok) position = result.position;
  }

  assert.throws(() => scoreTrainingSettlement({
    boardSize: 9,
    moves: position.moves,
    proposal: {
      contractVersion: "gostone-japanese-settlement-v1",
      authority: "proposal-only",
      modelVersion: GOSTONE_BOT_MODEL.modelVersion,
      modelSha256: GOSTONE_BOT_MODEL.artifactSha256,
      stoppedMoveNumber: 2,
      deadStones: [],
      uncertainStones: [{ x: 0, y: 0 }],
      neutralRegionSeeds: [],
    },
  }), /uncertain/);
});
