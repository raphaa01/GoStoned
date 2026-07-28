import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard } from "./goEngine";
import {
  JapaneseScoringError,
  scoreJapaneseTerritory,
} from "./japaneseScoring";
import type { Board, Position } from "./types";

function territoryFixture(): Board {
  const board = createEmptyBoard(9);
  board[0][0] = "black";
  board[8][8] = "white";
  for (const point of [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 2, y: 1 },
    { x: 1, y: 2 },
  ]) board[point.y][point.x] = "black";
  for (const point of [
    { x: 7, y: 6 },
    { x: 6, y: 7 },
    { x: 8, y: 7 },
    { x: 7, y: 8 },
  ]) board[point.y][point.x] = "white";
  return board;
}

function score(overrides: Partial<Parameters<typeof scoreJapaneseTerritory>[0]> = {}) {
  return scoreJapaneseTerritory({
    board: territoryFixture(),
    prisoners: { capturedWhiteByBlack: 2, capturedBlackByWhite: 1 },
    deadStones: [],
    agreedNeutralRegionSeeds: [],
    komi: 6.5,
    ...overrides,
  });
}

function assertScoringError(
  callback: () => unknown,
  code: JapaneseScoringError["code"],
) {
  assert.throws(callback, (error: unknown) =>
    error instanceof JapaneseScoringError && error.code === code,
  );
}

test("Japanese totals count territory and authoritative prisoners but not living stones", () => {
  const result = score();
  assert.equal(result.livingBlackStones, 5);
  assert.equal(result.livingWhiteStones, 5);
  assert.equal(result.blackTerritory, 1);
  assert.equal(result.whiteTerritory, 1);
  assert.equal(result.damePoints, 69);
  assert.equal(result.territoryExcludedByAgreement, 0);
  assert.equal(result.blackPrisonersFinal, 2);
  assert.equal(result.whitePrisonersFinal, 1);
  assert.equal(result.blackTotal, 3);
  assert.equal(result.whiteTotal, 8.5);
  assert.deepEqual(result.outcome, { kind: "points", winner: "white", margin: 5.5 });
  assert.equal(result.method, "territory");
});

test("an empty board is all dame and only komi contributes to the result", () => {
  const result = score({
    board: createEmptyBoard(9),
    prisoners: { capturedWhiteByBlack: 0, capturedBlackByWhite: 0 },
    komi: 6.5,
  });
  assert.equal(result.blackTerritory, 0);
  assert.equal(result.whiteTerritory, 0);
  assert.equal(result.damePoints, 81);
  assert.equal(result.blackTotal, 0);
  assert.equal(result.whiteTotal, 6.5);
  assert.deepEqual(result.outcome, { kind: "points", winner: "white", margin: 6.5 });
});

test("territory can be enclosed against two board edges", () => {
  const board = createEmptyBoard(9);
  board[0][2] = "black";
  board[1][1] = "black";
  board[2][0] = "black";
  board[8][8] = "white";
  const result = score({
    board,
    prisoners: { capturedWhiteByBlack: 0, capturedBlackByWhite: 0 },
    komi: 0,
  });
  assert.equal(result.blackTerritory, 3);
  assert.equal(result.whiteTerritory, 0);
  assert.equal(result.damePoints, 74);
  assert.deepEqual(result.outcome, { kind: "points", winner: "black", margin: 3 });
});

test("agreed dead groups add prisoners only when they lie in opponent territory", () => {
  const board = territoryFixture();
  board[1][1] = "white";
  const result = score({ board, deadStones: [{ x: 1, y: 1 }] });
  assert.equal(result.deadWhiteAwardedToBlack, 1);
  assert.equal(result.deadBlackAwardedToWhite, 0);
  assert.equal(result.blackTerritory, 1);
  assert.equal(result.blackPrisonersFinal, 3);
  assert.equal(result.blackTotal, 4);
  assert.deepEqual(result.outcome, { kind: "points", winner: "white", margin: 4.5 });
  assert.equal(board[1][1], "white", "settlement must not mutate the stopped board");

  const neutralBoard = territoryFixture();
  neutralBoard[4][4] = "black";
  assertScoringError(
    () => score({ board: neutralBoard, deadStones: [{ x: 4, y: 4 }] }),
    "dead_stone_not_in_opponent_territory",
  );

  const whiteTerritoryBoard = territoryFixture();
  whiteTerritoryBoard[7][7] = "black";
  const whiteResult = score({
    board: whiteTerritoryBoard,
    deadStones: [{ x: 7, y: 7 }],
  });
  assert.equal(whiteResult.deadBlackAwardedToWhite, 1);
  assert.equal(whiteResult.whitePrisonersFinal, 2);
  assert.equal(whiteResult.whiteTotal, 9.5);
});

test("one agreed seed excludes an otherwise-owned region from territory", () => {
  const result = score({ agreedNeutralRegionSeeds: [{ x: 1, y: 1 }] });
  assert.equal(result.blackTerritory, 0);
  assert.equal(result.whiteTerritory, 1);
  assert.equal(result.damePoints, 69);
  assert.equal(result.territoryExcludedByAgreement, 1);
  assert.deepEqual(result.outcome, { kind: "points", winner: "white", margin: 6.5 });
});

test("neutral-region agreement uses one canonical seed for owned regions only", () => {
  assertScoringError(
    () => score({ agreedNeutralRegionSeeds: [{ x: 4, y: 4 }] }),
    "invalid_neutral_region",
  );

  const board = createEmptyBoard(9);
  board[0][2] = "black";
  board[1][0] = "black";
  board[1][1] = "black";
  board[8][8] = "white";
  assertScoringError(
    () => score({
      board,
      agreedNeutralRegionSeeds: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    }),
    "invalid_neutral_region",
  );
});

test("Japanese settlement can produce jigo when territory, prisoners, and komi tie", () => {
  const result = score({
    prisoners: { capturedWhiteByBlack: 0, capturedBlackByWhite: 0 },
    komi: 0,
  });
  assert.equal(result.blackTotal, 1);
  assert.equal(result.whiteTotal, 1);
  assert.deepEqual(result.outcome, { kind: "jigo" });
});

test("dead-stone agreement must contain complete connected groups", () => {
  const board = territoryFixture();
  board[4][4] = "white";
  board[4][5] = "white";
  assertScoringError(
    () => score({ board, deadStones: [{ x: 4, y: 4 }] }),
    "partial_dead_group",
  );
});

test("a complete multi-stone dead group is counted exactly once", () => {
  const board = createEmptyBoard(9);
  for (const point of [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 1 },
    { x: 3, y: 1 },
    { x: 0, y: 2 },
    { x: 3, y: 2 },
    { x: 1, y: 3 },
    { x: 2, y: 3 },
  ]) board[point.y][point.x] = "black";
  board[1][1] = "white";
  board[1][2] = "white";
  board[8][8] = "white";
  const deadStones = [{ x: 1, y: 1 }, { x: 2, y: 1 }];

  const result = score({
    board,
    prisoners: { capturedWhiteByBlack: 0, capturedBlackByWhite: 0 },
    deadStones,
    komi: 0,
  });
  assert.equal(result.blackTerritory, 4);
  assert.equal(result.deadWhiteAwardedToBlack, 2);
  assert.equal(result.blackPrisonersFinal, 2);
  assert.equal(result.blackTotal, 6);
  assert.deepEqual(deadStones, [{ x: 1, y: 1 }, { x: 2, y: 1 }]);
  assert.equal(board[1][1], "white");
  assert.equal(board[1][2], "white");
});

test("settlement rejects malformed board, komi, prisoner, stone, and neutral inputs", () => {
  const invalidBoard = createEmptyBoard(9);
  invalidBoard[0].pop();
  assertScoringError(() => score({ board: invalidBoard }), "invalid_board");
  for (const komi of [NaN, Infinity, 6.25]) {
    assertScoringError(() => score({ komi }), "invalid_komi");
  }
  for (const prisoners of [
    { capturedWhiteByBlack: -1, capturedBlackByWhite: 0 },
    { capturedWhiteByBlack: 0.5, capturedBlackByWhite: 0 },
  ]) {
    assertScoringError(() => score({ prisoners }), "invalid_prisoners");
  }

  const board = territoryFixture();
  assertScoringError(
    () => score({ board, deadStones: [{ x: 1, y: 1 }] }),
    "invalid_dead_stone",
  );
  const duplicateDead: Position[] = [{ x: 1, y: 0 }, { x: 1, y: 0 }];
  assertScoringError(() => score({ board, deadStones: duplicateDead }), "invalid_dead_stone");
  assertScoringError(
    () => score({ board, agreedNeutralRegionSeeds: [{ x: 1, y: 0 }] }),
    "invalid_neutral_region",
  );
  assertScoringError(
    () => score({
      board,
      agreedNeutralRegionSeeds: [{ x: 1, y: 1 }, { x: 1, y: 1 }],
    }),
    "invalid_neutral_region",
  );
});
