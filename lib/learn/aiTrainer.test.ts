import assert from "node:assert/strict";
import test from "node:test";
import { trainerAnalysisInput, trainerBestMove, trainerBlackLead, trainerOpponentMove, trainerStrength, undoTrainerTurn, type TrainerPositionAnalysis } from "./aiTrainer";
import { applyTrainingAction, createTrainingPosition, type TrainingPosition } from "./trainingGame";
import type { GoStoneBotMove } from "@/lib/bot/modelV1";

function play(position: TrainingPosition, action: GoStoneBotMove) {
  const result = applyTrainingAction(position, action);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Illegal fixture move");
  return result.position;
}

function analysis(position: TrainingPosition): TrainerPositionAnalysis {
  return {
    turnNumber: position.moves.length,
    rootInfo: { currentPlayer: position.turn === "black" ? "B" : "W", visits: 80, scoreLead: 2, winrate: .6 },
    moveInfos: [
      { move: "D4", order: 0, visits: 60, scoreLead: 2, winrate: .6, pv: ["D4"] },
      { move: "E5", order: 1, visits: 10, scoreLead: -2, winrate: .4, pv: ["E5"] },
      { move: "pass", order: 2, visits: 4, scoreLead: -3, winrate: .3, pv: ["pass"] },
    ],
  };
}

test("trainer strength follows the player rating while help always uses the best legal candidate", () => {
  assert.equal(trainerStrength(null).rating, 1200);
  assert.deepEqual(trainerStrength(Number.NaN), trainerStrength(null));
  assert.equal(trainerStrength(-1).rating, 400);
  assert.equal(trainerStrength(9999).rating, 3000);
  assert.ok(trainerStrength(600).visits < trainerStrength(2400).visits);
  const position = createTrainingPosition(9);
  const result = analysis(position);
  assert.deepEqual(trainerBestMove(position, result), { kind: "play", x: 3, y: 5 });
  assert.deepEqual(trainerOpponentMove(position, result, trainerStrength(3000), () => .99), trainerBestMove(position, result));
  assert.deepEqual(trainerOpponentMove(position, result, trainerStrength(400), () => .99), { kind: "play", x: 4, y: 4 });
  assert.equal(trainerBlackLead(result), 2);
  assert.equal(trainerBlackLead({ ...result, rootInfo: { ...result.rootInfo, currentPlayer: "W" } }), -2);
});

test("trainer suggestions reject stale positions and illegal moves, and do not invent a fallback", () => {
  let position = createTrainingPosition(9);
  const stale = analysis(position);
  position = play(position, { kind: "play", x: 3, y: 5 });
  assert.throws(() => trainerBestMove(position, stale), /different position/);
  const result = analysis(position);
  assert.deepEqual(trainerBestMove(position, result), { kind: "play", x: 4, y: 4 });
  assert.throws(() => trainerBestMove(position, { ...result, moveInfos: [] }), /searched legal move/);
  const pass = { ...result, moveInfos: [{ ...result.moveInfos[0], move: "pass" }] };
  assert.deepEqual(trainerOpponentMove(position, pass, trainerStrength(400)), { kind: "pass" });
});

test("undo before or after the reply restores captured stones, prisoners, passes and the human turn", () => {
  let position = createTrainingPosition(9);
  position = play(position, { kind: "play", x: 1, y: 0 });
  position = play(position, { kind: "play", x: 0, y: 0 });
  const before = position;
  position = play(position, { kind: "play", x: 0, y: 1 });
  assert.equal(position.prisoners.capturedWhiteByBlack, 1);
  assert.deepEqual(undoTrainerTurn(position), before);
  position = play(position, { kind: "pass" });
  assert.deepEqual(undoTrainerTurn(position), before);
  position = play(position, { kind: "pass" });
  position = play(position, { kind: "pass" });
  const restored = undoTrainerTurn(position);
  assert.equal(restored.consecutivePasses, 1);
  assert.equal(restored.turn, "black");
  assert.equal(restored.moves.length, 4);
  assert.equal(restored.prisoners.capturedWhiteByBlack, 1);
});

test("analysis retains the real move history and monotonic revision across undo", () => {
  let position = createTrainingPosition(13);
  position = play(position, { kind: "play", x: 3, y: 9 });
  const input = trainerAnalysisInput(position, "practice", 4);
  assert.equal(input.rules, "japanese");
  assert.equal(input.komi, 6.5);
  assert.deepEqual(input.moves, [{ color: "black", move: "D4" }]);
  const undone = trainerAnalysisInput(undoTrainerTurn(position), "practice", 5);
  assert.equal(undone.gameVersion, 5);
  assert.deepEqual(undone.moves, []);
});
