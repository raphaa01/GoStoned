import assert from "node:assert/strict";
import test from "node:test";
import { LEARN_LESSONS, lessonById } from "./curriculum";
import { automaticReplyCount, continuesOwnTurn, stableLessonColor } from "./lessonFlow";
import { boardFromStones, createLearnGame, passLearnMove, playLearnMove, withLearnTurn } from "./lessonEngine";
import { boardHash } from "@/lib/game/goEngine";

test("all 120 lessons keep one learner colour, including mixed checks in stages 1–3", () => {
  for (const lesson of LEARN_LESSONS) {
    const colours = new Set(lesson.steps.filter((step) => step.kind === "play" || step.kind === "illegal").map((step) => step.toPlay ?? "black"));
    assert.ok(colours.size <= 1, lesson.id);
    assert.deepEqual(stableLessonColor(lesson), lesson, "Colour normalization must be idempotent");
  }
  assert.ok(lessonById("s3-life-death").steps.every((step) => step.toPlay === "black"));
  const kill = lessonById("s3-life-death").steps[1];
  assert.match(kill.body.de, /Schwarz/);
  assert.match(kill.replyExplanations![1].de, /Weiß schließt/);
  const ko = lessonById("s2-first-game").steps[1];
  assert.equal(ko.toPlay, "black");
  assert.match(ko.body.en, /White has just captured the black stone/);
  assert.ok(ko.koPreviousBoard, "A colour-swapped ko still needs the actual predecessor");
});

test("one opponent reply is automatic, never a whole trainer explanation", () => {
  for (const lesson of LEARN_LESSONS) for (const step of lesson.steps) {
    assert.equal(automaticReplyCount(step), step.kind === "play" && step.replies?.length ? 1 : 0);
  }
  assert.equal(automaticReplyCount(lessonById("s3-life-death").steps[1]), 1);
  assert.equal(lessonById("s3-life-death").steps[1].replies!.length, 2);
  const commented = lessonById("s5-commented-game").steps.find((step) => (step.replies?.length ?? 0) > 1)!;
  assert.ok(commented.replies!.length > 8);
  assert.equal(automaticReplyCount(commented), 1);
});

test("only ongoing own decisions advance directly; new tasks, explanations and games wait", () => {
  for (const lesson of LEARN_LESSONS) for (const [index, step] of lesson.steps.entries()) {
    const next = lesson.steps[index + 1];
    if (!continuesOwnTurn(step, next)) continue;
    assert.equal(step.toPlay, next.toPlay, `${lesson.id}: colour changed during a line`);
    if (lesson.id === "s1-board") continue; // Arbitrary placements retain the user's actual board.
    let state = withLearnTurn(createLearnGame(step.size!, step.stones), step.toPlay!);
    const own = playLearnMove(state, step.targets![0]);
    assert.ok(own.ok); state = own.position;
    for (const reply of step.replies ?? []) {
      if (reply === null) state = passLearnMove(state);
      else { const move = playLearnMove(state, reply); assert.ok(move.ok); state = move.position; }
    }
    assert.equal(state.turn, next.toPlay, `${lesson.id}/${step.id}: not the learner's turn`);
    assert.equal(boardHash(state.board), boardHash(boardFromStones(next.size!, next.stones!)), `${lesson.id}: board must not jump/reset`);
  }
  const ladder = lessonById("s4-ladder").steps.slice(0, 10);
  assert.ok(ladder.slice(0, -1).every((step, index) => continuesOwnTurn(step, ladder[index + 1])));
  assert.equal(continuesOwnTurn(ladder.at(-1)!, undefined), false);
  const net = lessonById("s4-net").steps.filter((step) => step.kind === "play");
  assert.equal(continuesOwnTurn(net[2], net[3]), false, "A different puzzle must wait for Continue");
});

test("the corner and wider nets teach different captures", () => {
  const decisions = lessonById("s4-net").steps.filter((step) => step.kind === "play");
  const starts = decisions.filter((step) => !step.continuePosition);
  assert.deepEqual(starts.map((step) => step.size), [5, 7]);
  const finishing = decisions.filter((_, index) => !decisions[index + 1]?.continuePosition);
  assert.deepEqual(finishing.map((step) => {
    const state = withLearnTurn(createLearnGame(step.size!, step.stones), step.toPlay!);
    const own = playLearnMove(state, step.targets![0]);
    assert.ok(own.ok);
    return own.captured.length;
  }), [3, 4]);
});
