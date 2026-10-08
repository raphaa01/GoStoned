import assert from "node:assert/strict";
import test from "node:test";
import { createTrainingPosition, applyTrainingAction, type TrainingPosition } from "./trainingGame";
import { buildCoachEvidence, coachInfluence, coachJudgement } from "./coachEvidence";
import type { TrainerPositionAnalysis } from "./aiTrainer";
import { toGtpCoordinate } from "@/lib/analysis/coordinates";

function play(p: TrainingPosition, x: number, y: number) {
  const result = applyTrainingAction(p, { kind: "play", x, y });
  if (!result.ok) throw new Error(`Invalid fixture ${x},${y}`);
  return result.position;
}
function analysis(p: TrainingPosition, x: number, y: number, lead = 0, visits = 32): TrainerPositionAnalysis {
  return { turnNumber: p.moves.length, rootInfo: { currentPlayer: p.turn === "black" ? "B" : "W", visits, winrate: .5, scoreLead: lead }, moveInfos: [{ move: toGtpCoordinate(p.boardSize, { x, y, isPass: false }), order: 0, visits: visits - 1, scoreLead: lead, winrate: .5, pv: [] }] };
}

test("real opening move fills the 63-feature and top-left 11-plane contract", () => {
  const before = createTrainingPosition(9); const after = play(before, 2, 6);
  const e = buildCoachEvidence(before, after, analysis(before, 2, 6, -1), analysis(after, 6, 2, 1));
  assert.equal(e.context.length, 63); assert.equal(e.board.length, 3971);
  assert.equal(e.loss, 0); assert.equal(e.judgement, "good");
  assert.ok(e.facts.includes("played:opening_corner"));
  assert.equal(e.board[2 * 361 + 6 * 19 + 2], 1);
  assert.equal(e.board[4 * 361 + 6 * 19 + 2], 1);
  assert.equal(e.board[7 * 361 + 8 * 19 + 8], 1);
  assert.equal(e.board[7 * 361 + 9 * 19 + 9], 0);
  assert.equal(e.board[8 * 361 + 6 * 19 + 2], 1);
  assert.equal(e.board[10 * 361 + 6 * 19 + 2], 1);
  assert.ok(!e.reasons.includes("human_insight"));
  assert.throws(() => buildCoachEvidence(after, before, analysis(after, 6, 2), analysis(before, 2, 6)), /human move/);
});

test("own atari is proven by a legal capturing reply, not by a score loss", () => {
  let before = createTrainingPosition(9);
  before = play(before, 8, 8); before = play(before, 1, 0);
  const after = play(before, 0, 0);
  const e = buildCoachEvidence(before, after, analysis(before, 2, 6, 2), analysis(after, 0, 1, 8), true);
  assert.equal(e.loss, 10); assert.equal(e.judgement, "blunder");
  assert.ok(e.facts.includes("played:own_threat"));
  assert.equal(e.numbers.libertiesAfter, 1); assert.equal(e.numbers.lost, 1);
  assert.deepEqual(e.marks.own_threat, [{ x: 0, y: 0 }]);
  assert.ok(!e.facts.includes("played:group_loss"));
});

test("connecting distinct groups and gaining liberties is grounded locally", () => {
  let before = createTrainingPosition(9);
  for (const [x, y] of [[1, 2], [8, 8], [3, 2], [8, 7]]) before = play(before, x, y);
  const after = play(before, 2, 2);
  const e = buildCoachEvidence(before, after, analysis(before, 2, 2), analysis(after, 8, 6));
  assert.ok(e.facts.includes("played:connect")); assert.equal(e.numbers.connected, 2);
  assert.equal(e.context[33], .5);
  assert.equal(e.marks.connect?.length, 3);
});

test("uncertain scans cannot become confident mistakes; ownership flips with side to move", () => {
  assert.equal(coachJudgement(30, false), "uncertain");
  assert.deepEqual([0, 1, 3, 8].map(loss => coachJudgement(loss, true)), ["good", "inaccuracy", "mistake", "blunder"]);
  const black = createTrainingPosition(9);
  const a = { ...analysis(black, 2, 6), ownership: [1, -1, ...Array(79).fill(0)] };
  assert.deepEqual(coachInfluence(black, a), { black: [{ x: 0, y: 0 }], white: [{ x: 1, y: 0 }] });
  const white = play(black, 8, 8);
  assert.deepEqual(coachInfluence(white, { ...analysis(white, 2, 6), ownership: a.ownership }), { white: [{ x: 0, y: 0 }], black: [{ x: 1, y: 0 }] });
  assert.throws(() => coachInfluence(white, a), /Stale/);
});
