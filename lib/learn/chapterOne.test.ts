import assert from "node:assert/strict";
import test from "node:test";
import type { Position } from "@/lib/game/types";
import {
  CAPTURE_MOVE,
  CHAPTER_ONE_LESSON_IDS,
  CHAPTER_ONE_LESSONS,
  chapterOneCopy,
  CONNECT_MOVE,
  ESCAPE_MOVE,
  LESSON_BOARD_SIZE,
  LESSON_SETUPS,
  LIBERTY_POINTS,
  PLACE_MOVE,
  TERRITORY_MOVE,
  TERRITORY_POINT,
  type LessonStone,
} from "./chapterOne";

const orthogonalNeighbours = ({ x, y }: Position) => [
  { x, y: y - 1 },
  { x: x - 1, y },
  { x: x + 1, y },
  { x, y: y + 1 },
].filter(({ x: nextX, y: nextY }) => (
  nextX >= 0 && nextX < LESSON_BOARD_SIZE && nextY >= 0 && nextY < LESSON_BOARD_SIZE
));

const samePoint = (left: Position, right: Position) => left.x === right.x && left.y === right.y;

function groupAt(stones: readonly LessonStone[], start: Position): LessonStone[] {
  const first = stones.find((stone) => samePoint(stone, start));
  if (!first) return [];
  const group: LessonStone[] = [];
  const pending = [first];
  while (pending.length > 0) {
    const stone = pending.pop();
    if (!stone || group.some((member) => samePoint(member, stone))) continue;
    group.push(stone);
    for (const neighbour of orthogonalNeighbours(stone)) {
      const connected = stones.find((candidate) => candidate.color === first.color && samePoint(candidate, neighbour));
      if (connected) pending.push(connected);
    }
  }
  return group;
}

function liberties(stones: readonly LessonStone[], group: readonly LessonStone[]): Position[] {
  const result: Position[] = [];
  for (const stone of group) {
    for (const neighbour of orthogonalNeighbours(stone)) {
      if (stones.some((candidate) => samePoint(candidate, neighbour))) continue;
      if (!result.some((liberty) => samePoint(liberty, neighbour))) result.push(neighbour);
    }
  }
  return result;
}

test("the beginner lesson progresses through six clearly named basic rules", () => {
  assert.deepEqual(CHAPTER_ONE_LESSONS.map(({ id }) => id), CHAPTER_ONE_LESSON_IDS);
  assert.deepEqual(CHAPTER_ONE_LESSON_IDS, ["place", "liberties", "capture", "escape", "connect", "territory"]);

  for (const locale of ["en", "de"] as const) {
    const copy = chapterOneCopy(locale);
    assert.match(copy.kicker, locale === "de" ? /Einsteiger/ : /Beginner/);
    const titles: string[] = CHAPTER_ONE_LESSON_IDS.map((id) => copy.lessons[id].title);
    assert.equal(new Set(titles).size, 6);
    for (const id of CHAPTER_ONE_LESSON_IDS) {
      assert.ok(copy.lessons[id].instruction.length > 0);
      assert.ok(copy.lessons[id].wrong.length > 0);
      assert.ok(copy.lessons[id].success.length > 0);
    }
  }
});

test("all teaching positions stay inside the compact practice board", () => {
  const targets = [PLACE_MOVE, ...LIBERTY_POINTS, CAPTURE_MOVE, ESCAPE_MOVE, CONNECT_MOVE, TERRITORY_POINT, TERRITORY_MOVE];
  for (const { x, y } of [...Object.values(LESSON_SETUPS).flat(), ...targets]) {
    assert.ok(x >= 0 && x < LESSON_BOARD_SIZE);
    assert.ok(y >= 0 && y < LESSON_BOARD_SIZE);
  }
});

test("each exercise presents a valid and unambiguous Go concept", () => {
  assert.deepEqual(LESSON_SETUPS.place, []);
  assert.deepEqual(LIBERTY_POINTS, orthogonalNeighbours({ x: 2, y: 2 }));

  const capturePosition = [...LESSON_SETUPS.capture, { ...CAPTURE_MOVE, color: "black" as const }];
  assert.equal(liberties(capturePosition, groupAt(capturePosition, { x: 2, y: 2 })).length, 0);

  const escapeBefore = LESSON_SETUPS.escape;
  assert.deepEqual(liberties(escapeBefore, groupAt(escapeBefore, { x: 2, y: 2 })), [ESCAPE_MOVE]);
  const escapeAfter = [...escapeBefore, { ...ESCAPE_MOVE, color: "black" as const }];
  assert.equal(groupAt(escapeAfter, { x: 2, y: 2 }).length, 2);
  assert.equal(liberties(escapeAfter, groupAt(escapeAfter, { x: 2, y: 2 })).length, 3);

  const connected = [...LESSON_SETUPS.connect, { ...CONNECT_MOVE, color: "black" as const }];
  assert.equal(groupAt(connected, CONNECT_MOVE).length, 3);

  const territory = [...LESSON_SETUPS.territory, { ...TERRITORY_MOVE, color: "black" as const }];
  const surroundingStones = orthogonalNeighbours(TERRITORY_POINT).map((point) => (
    territory.find((stone) => stone.color === "black" && samePoint(stone, point))
  ));
  assert.ok(surroundingStones.every(Boolean));
});
