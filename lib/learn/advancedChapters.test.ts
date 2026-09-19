import assert from "node:assert/strict";
import test from "node:test";
import type { Position } from "@/lib/game/types";
import {
  ADVANCED_CHAPTERS,
  advancedChapterCopy,
  LIFE_LESSON_IDS,
  TACTICS_LESSON_IDS,
  type AdvancedLesson,
} from "./advancedChapters";
import { lessonPositionKey, type LessonStone } from "./chapterOne";

const neighbours = ({ x, y }: Position, size: number) => [
  { x, y: y - 1 },
  { x: x - 1, y },
  { x: x + 1, y },
  { x, y: y + 1 },
].filter((point) => point.x >= 0 && point.y >= 0 && point.x < size && point.y < size);

function groupAt(stones: readonly LessonStone[], start: Position): LessonStone[] {
  const first = stones.find((stone) => stone.x === start.x && stone.y === start.y);
  if (!first) return [];
  const group: LessonStone[] = [];
  const pending = [first];
  while (pending.length > 0) {
    const stone = pending.pop();
    if (!stone || group.some((member) => lessonPositionKey(member) === lessonPositionKey(stone))) continue;
    group.push(stone);
    for (const neighbour of neighbours(stone, 19)) {
      const connected = stones.find((candidate) => candidate.color === first.color && lessonPositionKey(candidate) === lessonPositionKey(neighbour));
      if (connected) pending.push(connected);
    }
  }
  return group;
}

function liberties(stones: readonly LessonStone[], group: readonly LessonStone[], size: number) {
  const occupied = new Set(stones.map(lessonPositionKey));
  return [...new Map(group.flatMap((stone) => neighbours(stone, size))
    .filter((position) => !occupied.has(lessonPositionKey(position)))
    .map((position) => [lessonPositionKey(position), position])).values()];
}

function withMove(lesson: AdvancedLesson): LessonStone[] {
  const remove = new Set((lesson.remove ?? []).map(lessonPositionKey));
  return [
    ...lesson.stones.filter((stone) => !remove.has(lessonPositionKey(stone))),
    { ...lesson.targets[0], color: lesson.toPlay },
  ];
}

function lesson(id: string): AdvancedLesson {
  const found = Object.values(ADVANCED_CHAPTERS).flatMap(({ lessons }) => lessons).find((candidate) => candidate.id === id);
  assert.ok(found, `missing lesson ${id}`);
  return found;
}

test("the new curriculum follows life-and-death with concrete tactics", () => {
  assert.deepEqual(ADVANCED_CHAPTERS.life.lessons.map(({ id }) => id), LIFE_LESSON_IDS);
  assert.deepEqual(ADVANCED_CHAPTERS.tactics.lessons.map(({ id }) => id), TACTICS_LESSON_IDS);
  for (const locale of ["en", "de"] as const) {
    const life = advancedChapterCopy("life", locale);
    const tactics = advancedChapterCopy("tactics", locale);
    assert.match(life.lessons["two-eyes"].title, locale === "de" ? /Augen/ : /eyes/i);
    assert.match(life.lessons["false-eye"].success, locale === "de" ? /kein sicheres Auge/ : /not a secure eye/i);
    assert.match(tactics.lessons.ko.success, locale === "de" ? /nicht sofort/ : /not recapture immediately/i);
  }
});

test("every teaching position is bounded, unique, and asks for an empty point", () => {
  for (const chapter of Object.values(ADVANCED_CHAPTERS)) {
    for (const item of chapter.lessons) {
      const stoneKeys = item.stones.map(lessonPositionKey);
      const targetKeys = item.targets.map(lessonPositionKey);
      assert.equal(new Set(stoneKeys).size, stoneKeys.length, `${item.id} has duplicate stones`);
      assert.equal(new Set(targetKeys).size, targetKeys.length, `${item.id} has duplicate targets`);
      for (const position of [...item.stones, ...item.targets]) {
        assert.ok(position.x >= 0 && position.y >= 0 && position.x < item.size && position.y < item.size, `${item.id} is out of bounds`);
      }
      assert.ok(targetKeys.every((key) => !stoneKeys.includes(key)), `${item.id} targets an occupied point`);
    }
  }
});

test("the eye lessons distinguish real eyes, two eyes, false eyes, and the vital point", () => {
  const oneEye = lesson("one-eye");
  assert.ok(neighbours(oneEye.targets[0], oneEye.size).every((position) => oneEye.stones.some((stone) => stone.color === "black" && lessonPositionKey(stone) === lessonPositionKey(position))));
  assert.ok(oneEye.stones.some((stone) => stone.color === "black" && stone.x === 1 && stone.y === 1), "corner eye needs the friendly diagonal");

  const twoEyes = lesson("two-eyes");
  const connectedBlack = groupAt(twoEyes.stones, twoEyes.stones[0]);
  assert.equal(connectedBlack.length, twoEyes.stones.length, "the two-eye boundary must be one connected group");
  for (const eye of twoEyes.targets) {
    assert.ok(neighbours(eye, twoEyes.size).every((position) => twoEyes.stones.some((stone) => stone.color === "black" && lessonPositionKey(stone) === lessonPositionKey(position))));
    const friendlyDiagonals = [
      { x: eye.x - 1, y: eye.y - 1 },
      { x: eye.x + 1, y: eye.y - 1 },
      { x: eye.x - 1, y: eye.y + 1 },
      { x: eye.x + 1, y: eye.y + 1 },
    ].filter((position) => twoEyes.stones.some((stone) => stone.color === "black" && lessonPositionKey(stone) === lessonPositionKey(position)));
    assert.equal(friendlyDiagonals.length, 4, "each central eye must have four friendly diagonals");
  }

  const falseEye = lesson("false-eye");
  const vulnerableStone = groupAt(falseEye.stones, { x: 2, y: 1 });
  assert.deepEqual(liberties(falseEye.stones, vulnerableStone, falseEye.size), falseEye.targets);

  for (const id of ["vital-point", "make-life"]) {
    const straightThree = lesson(id);
    const innerSpace = [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }];
    assert.deepEqual(straightThree.targets, [{ x: 2, y: 2 }]);
    assert.ok(innerSpace.every((position) => !straightThree.stones.some((stone) => lessonPositionKey(stone) === lessonPositionKey(position))));
  }
});

test("the seki example gives both groups exactly two shared liberties", () => {
  const seki = lesson("seki");
  const blackGroup = groupAt(seki.stones, { x: 0, y: 0 });
  const whiteGroup = groupAt(seki.stones, { x: 2, y: 0 });
  const blackLiberties = liberties(seki.stones, blackGroup, seki.size);
  const whiteLiberties = liberties(seki.stones, whiteGroup, seki.size);
  assert.deepEqual(blackLiberties, seki.targets);
  assert.deepEqual(whiteLiberties, seki.targets);

  for (const [firstTarget, secondTarget, firstColor] of [
    [seki.targets[0], seki.targets[1], "black"],
    [seki.targets[0], seki.targets[1], "white"],
  ] as const) {
    const afterBothMoves: LessonStone[] = [
      ...seki.stones,
      { ...firstTarget, color: firstColor },
      { ...secondTarget, color: firstColor === "black" ? "white" : "black" },
    ];
    const firstGroup = groupAt(afterBothMoves, firstTarget);
    assert.equal(liberties(afterBothMoves, firstGroup, seki.size).length, 0, "the player who fills first must be captured");
  }
});

test("each tactical move has the exact liberty effect described by its lesson", () => {
  const direction = lesson("atari-direction");
  const directionAfter = withMove(direction);
  assert.deepEqual(liberties(directionAfter, groupAt(directionAfter, { x: 2, y: 2 }), direction.size), [{ x: 2, y: 4 }]);

  const doubleAtari = lesson("double-atari");
  const doubleAfter = withMove(doubleAtari);
  assert.equal(liberties(doubleAfter, groupAt(doubleAfter, { x: 1, y: 2 }), doubleAtari.size).length, 1);
  assert.equal(liberties(doubleAfter, groupAt(doubleAfter, { x: 3, y: 2 }), doubleAtari.size).length, 1);

  for (const id of ["edge-capture", "capturing-race"]) {
    const capture = lesson(id);
    const targetGroup = groupAt(capture.stones, capture.remove?.[0] ?? { x: -1, y: -1 });
    const beforeMove = [...capture.stones, { ...capture.targets[0], color: capture.toPlay }];
    assert.equal(liberties(beforeMove, targetGroup, capture.size).length, 0, `${id} must fill the last liberty`);
  }

  const ladder = lesson("ladder");
  const ladderAfter = withMove(ladder);
  assert.deepEqual(liberties(ladderAfter, groupAt(ladderAfter, { x: 1, y: 1 }), ladder.size), [{ x: 2, y: 1 }]);

  const ko = lesson("ko");
  const koAfter = withMove(ko);
  assert.deepEqual(liberties(koAfter, groupAt(koAfter, ko.targets[0]), ko.size), [{ x: 2, y: 2 }]);
});
