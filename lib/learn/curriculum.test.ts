import assert from "node:assert/strict";
import test from "node:test";
import { boardHash } from "@/lib/game/goEngine";
import { LEARN_LESSONS, LEARN_STAGES, line } from "./curriculum";
import {
  boardFromStones,
  createLearnGame,
  playLearnMove,
  pointKey,
  withLearnTurn,
} from "./lessonEngine";
import { LEARN_LESSON_IDS } from "./progress";

test("the beginner curriculum is one complete linear path through stages one to three", () => {
  assert.deepEqual(LEARN_STAGES.map(({ id }) => id), [1, 2, 3]);
  assert.deepEqual(LEARN_LESSONS.map(({ id }) => id), LEARN_LESSON_IDS);
  assert.equal(LEARN_LESSONS.length, 31);
  assert.equal(LEARN_LESSONS.filter(({ challenge }) => challenge).length, 4);
  assert.deepEqual(
    LEARN_LESSONS.filter(({ steps }) => steps.some(({ kind }) => kind.endsWith("game"))).map(({ id }) => id),
    ["s1-capture-go", "s2-first-game", "s3-second-game"],
  );
});

test("every teaching board is bounded, unique, and every requested action is playable", () => {
  for (const lesson of LEARN_LESSONS) {
    assert.ok(lesson.steps.length >= 1, `${lesson.id} has no steps`);
    for (const step of lesson.steps) {
      for (const locale of ["de", "en"] as const) {
        assert.ok(line(step.body, locale).length > 0, `${lesson.id}/${step.id} has empty copy`);
        assert.ok(line(step.body, locale).length <= 260, `${lesson.id}/${step.id} is too verbose`);
      }
      if (!step.size) continue;
      assert.ok(step.size >= 5 && step.size <= 9, `${lesson.id}/${step.id} uses an unexpected board size`);
      const stoneKeys = (step.stones ?? []).map(pointKey);
      assert.equal(new Set(stoneKeys).size, stoneKeys.length, `${lesson.id}/${step.id} has duplicate stones`);
      for (const point of [...(step.stones ?? []), ...(step.targets ?? []), ...(step.emphasis ?? []), ...(step.territory ?? []), ...(step.group ?? [])]) {
        assert.ok(point.x >= 0 && point.y >= 0 && point.x < step.size && point.y < step.size, `${lesson.id}/${step.id} is out of bounds at ${pointKey(point)}`);
      }
      const board = boardFromStones(step.size, step.stones ?? []);
      if (step.kind === "select") {
        assert.ok((step.targets?.length ?? 0) > 0, `${lesson.id}/${step.id} has no selection target`);
        for (const target of step.targets ?? []) {
          const occupied = board[target.y][target.x] !== null;
          assert.equal(occupied, step.selectFrom === "stone", `${lesson.id}/${step.id} selection type is wrong at ${pointKey(target)}`);
        }
      }
      if (step.kind !== "play" && step.kind !== "illegal") continue;
      let position = withLearnTurn(createLearnGame(step.size, step.stones ?? []), step.toPlay ?? "black");
      if (step.koPreviousBoard) {
        const previous = boardFromStones(step.size, step.koPreviousBoard);
        position = { ...position, history: [boardHash(previous), boardHash(position.board)] };
      }
      const moveTargets = step.targets ?? (step.kind === "play" ? [{ x: 0, y: 0 }] : []);
      assert.ok(moveTargets.length > 0, `${lesson.id}/${step.id} has no move target`);
      for (const target of moveTargets) {
        assert.equal(board[target.y][target.x], null, `${lesson.id}/${step.id} asks for an occupied target`);
        const result = playLearnMove(position, target);
        if (step.kind === "illegal") {
          assert.equal(result.ok, false, `${lesson.id}/${step.id} should demonstrate an illegal move`);
          if (!result.ok) assert.equal(result.error, step.expectedError, `${lesson.id}/${step.id} demonstrates the wrong error`);
        } else {
          assert.equal(result.ok, true, `${lesson.id}/${step.id} target ${pointKey(target)} is illegal`);
        }
      }
    }
  }
});

test("capture lessons really remove the claimed stones", () => {
  const captureLesson = LEARN_LESSONS.find(({ id }) => id === "s1-capture")!;
  const expected = new Map([["single", 1], ["edge", 1], ["group", 2]]);
  for (const step of captureLesson.steps) {
    const position = withLearnTurn(createLearnGame(step.size!, step.stones), step.toPlay ?? "black");
    const result = playLearnMove(position, step.targets![0]);
    assert.ok(result.ok);
    assert.equal(result.captured.length, expected.get(step.id));
  }

  const escape = LEARN_LESSONS.find(({ id }) => id === "s1-escape")!.steps.find(({ id }) => id === "capture-attacker")!;
  const escaped = playLearnMove(withLearnTurn(createLearnGame(escape.size!, escape.stones), "black"), escape.targets![0]);
  assert.ok(escaped.ok);
  assert.equal(escaped.captured.length, 1);
});
