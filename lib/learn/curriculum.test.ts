import assert from "node:assert/strict";
import test from "node:test";
import { boardHash, getGroup } from "@/lib/game/goEngine";
import { LEARN_LESSONS, LEARN_STAGES, line } from "./curriculum";
import {
  boardFromStones,
  createLearnGame,
  playLearnMove,
  pointKey,
  withLearnTurn,
  allGroups,
  groupLiberties,
  territoryPoints,
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
      for (const group of allGroups(board)) {
        assert.ok(groupLiberties(board, group[0]).length > 0, `${lesson.id}/${step.id} contains an already captured group`);
      }
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
          if (result.ok) {
            let after = result.position;
            for (const reply of step.replies ?? []) {
              const next = playLearnMove(after, reply);
              assert.ok(next.ok, `${lesson.id}/${step.id} has an illegal teaching reply ${pointKey(reply)}`);
              if (next.ok) after = next.position;
            }
          }
        }
      }
    }
  }
});

test("liberty, group, atari and territory answers match the actual teaching boards", () => {
  const keys = (points: readonly {x: number; y: number}[]) => points.map(pointKey).sort();
  for (const step of LEARN_LESSONS.find((lesson) => lesson.id === "s1-liberties")!.steps) {
    const board = boardFromStones(step.size!, step.stones!);
    assert.deepEqual(keys(step.targets!), keys(groupLiberties(board, step.stones![0])));
  }
  for (const step of LEARN_LESSONS.find((lesson) => lesson.id === "s1-atari")!.steps.filter((step) => step.kind === "play")) {
    const position = withLearnTurn(createLearnGame(step.size!, step.stones), "white");
    const actualSolutions = [];
    for (let y = 0; y < step.size!; y++) for (let x = 0; x < step.size!; x++) {
      const result = playLearnMove(position, {x, y});
      if (result.ok && groupLiberties(result.position.board, {x: 2, y: 2}).length === 1) actualSolutions.push({x, y});
    }
    assert.deepEqual(keys(step.targets!), keys(actualSolutions), `${step.id} omits a valid answer`);
  }
  const groupStep = LEARN_LESSONS.find((lesson) => lesson.id === "s1-groups")!.steps.at(-1)!;
  assert.deepEqual(keys(groupStep.targets!), keys(getGroup(boardFromStones(groupStep.size!, groupStep.stones!), groupStep.targets![0])));
  for (const [stepIndex, color, count] of [[0, "black", 4], [1, "white", 2]] as const) {
    const step = LEARN_LESSONS.find((lesson) => lesson.id === "s2-counting")!.steps[stepIndex];
    const actual = territoryPoints(boardFromStones(step.size!, step.stones!), color);
    assert.equal(actual.length, count);
    assert.deepEqual(keys(step.targets!), keys(actual));
  }
});

test("two eyes prevent capture, one eye is capturable, and seki punishes either first fill", () => {
  const eyes = LEARN_LESSONS.find((lesson) => lesson.id === "s3-two-eyes")!.steps;
  for (const step of eyes.filter((step) => step.kind === "illegal")) {
    const position = withLearnTurn(createLearnGame(step.size!, step.stones), "white");
    assert.equal(allGroups(position.board, "black").length, 1);
    assert.equal(groupLiberties(position.board, allGroups(position.board, "black")[0][0]).length, 2);
    for (const point of step.targets!) assert.deepEqual(playLearnMove(position, point), {ok: false, error: "suicide"});
  }
  const one = LEARN_LESSONS.find((lesson) => lesson.id === "s3-one-eye")!.steps.at(-1)!;
  const capture = playLearnMove(withLearnTurn(createLearnGame(one.size!, one.stones), "white"), one.targets![0]);
  assert.ok(capture.ok);
  assert.equal(capture.captured.length, 3);
  const seki = LEARN_LESSONS.find((lesson) => lesson.id === "s3-seki")!.steps[0];
  for (const color of ["black", "white"] as const) for (const [first, second] of [[0, 1], [1, 0]]) {
    const start = withLearnTurn(createLearnGame(seki.size!, seki.stones), color);
    assert.equal(allGroups(start.board).length, 2);
    const fill = playLearnMove(start, seki.targets![first]);
    assert.ok(fill.ok);
    assert.equal(fill.captured.length, 0);
    const punishment = playLearnMove(fill.position, seki.targets![second]);
    assert.ok(punishment.ok);
    assert.ok(punishment.captured.length > 0);
    assert.equal(allGroups(punishment.position.board, color).length, 0);
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
