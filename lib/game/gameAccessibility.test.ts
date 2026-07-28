import assert from "node:assert/strict";
import test from "node:test";
import { en } from "@/lib/i18n/catalogs/en";
import { createEmptyBoard } from "./goEngine";
import { describeGameChange } from "./gameAccessibility";
import type { GameState } from "./types";

function game(overrides: Partial<GameState> = {}): GameState {
  return {
    id: "game-1",
    boardSize: 9,
    blackPlayerKey: "black",
    whitePlayerKey: "white",
    blackPlayerName: "Black player",
    whitePlayerName: "White player",
    winnerKey: null,
    rated: false,
    status: "active",
    phase: "play",
    result: null,
    finishReason: null,
    komi: 7.5,
    ruleset: "chinese",
    rulesProfile: "chinese-2002-gostone-v1",
    scoringMethod: "area",
    handicap: 0,
    consecutivePasses: 0,
    scoringRevision: 0,
    scoring: null,
    lastResume: null,
    version: 1,
    startedAt: "2026-07-28T00:00:00.000Z",
    finishedAt: null,
    timeControl: "rapid",
    clock: {
      serverNow: "2026-07-28T00:00:00.000Z",
      mainTimeSeconds: 600,
      byoYomiPeriods: 3,
      byoYomiSeconds: 30,
      black: { mainTimeMs: 600_000, periodsRemaining: 3, displayTimeMs: 600_000, phase: "main" },
      white: { mainTimeMs: 600_000, periodsRemaining: 3, displayTimeMs: 600_000, phase: "main" },
    },
    turn: "black",
    moveCount: 0,
    board: createEmptyBoard(9),
    moves: [],
    ...overrides,
  };
}

test("announces a move, capture count, authentic coordinate, and next turn", () => {
  const previousBoard = createEmptyBoard(9);
  previousBoard[1][1] = "white";
  const nextBoard = createEmptyBoard(9);
  nextBoard[2][2] = "black";
  const previous = game({ board: previousBoard });
  const next = game({
    board: nextBoard,
    moveCount: 1,
    turn: "white",
    moves: [{ moveNumber: 1, color: "black", x: 2, y: 2, isPass: false, createdAt: "2026-07-28T00:01:00.000Z" }],
  });

  assert.equal(
    describeGameChange(previous, next, en.game),
    "Black played C7. 1 stone was captured. White to play.",
  );
});

test("announces passes and scoring transitions without exposing ticking clocks", () => {
  const previous = game();
  const afterPass = game({
    moveCount: 1,
    turn: "white",
    moves: [{ moveNumber: 1, color: "black", x: null, y: null, isPass: true, createdAt: "2026-07-28T00:01:00.000Z" }],
  });
  assert.equal(describeGameChange(previous, afterPass, en.game), "Black passed. White to play.");
  assert.equal(
    describeGameChange(afterPass, game({ phase: "scoring" }), en.game),
    en.game.scoringStartedAnnouncement,
  );
});

test("announces shared dead-group changes and cleared confirmations", () => {
  const board = createEmptyBoard(9);
  board[2][2] = "black";
  board[2][3] = "black";
  const scoring = {
    revision: 1,
    boardHash: "hash",
    stoppedMoveNumber: 4,
    deadStones: [] as Array<{ x: number; y: number }>,
    blackConfirmed: true,
    whiteConfirmed: false,
    preview: {
      black: 0,
      white: 7.5,
      blackStones: 2,
      whiteStones: 0,
      blackTerritory: 0,
      whiteTerritory: 0,
      neutralPoints: 79,
      winner: "white" as const,
      margin: 7.5,
      result: "W+7.5",
    },
    finalizedAt: null,
    expiresAt: "2026-07-28T00:06:00.000Z",
  };
  const previous = game({ board, phase: "scoring", scoring, scoringRevision: 1 });
  const next = game({
    board,
    phase: "scoring",
    scoring: {
      ...scoring,
      revision: 2,
      deadStones: [{ x: 2, y: 2 }, { x: 3, y: 2 }],
      blackConfirmed: false,
    },
    scoringRevision: 2,
  });

  assert.equal(
    describeGameChange(previous, next, en.game),
    "The black group at C7 was marked dead (2 stones). Previous confirmations were cleared.",
  );
});

test("keeps separate groups truthful when polling skips scoring revisions", () => {
  const board = createEmptyBoard(9);
  board[2][2] = "black";
  board[2][3] = "black";
  board[6][6] = "white";
  const baseScoring = {
    revision: 1,
    boardHash: "hash",
    stoppedMoveNumber: 8,
    deadStones: [] as Array<{ x: number; y: number }>,
    blackConfirmed: false,
    whiteConfirmed: false,
    preview: {
      black: 2,
      white: 8.5,
      blackStones: 2,
      whiteStones: 1,
      blackTerritory: 0,
      whiteTerritory: 0,
      neutralPoints: 78,
      winner: "white" as const,
      margin: 6.5,
      result: "W+6.5",
    },
    finalizedAt: null,
    expiresAt: "2026-07-28T00:06:00.000Z",
  };
  const previous = game({ board, phase: "scoring", scoring: baseScoring });
  const next = game({
    board,
    phase: "scoring",
    scoring: {
      ...baseScoring,
      revision: 3,
      deadStones: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 6, y: 6 }],
    },
  });

  assert.equal(
    describeGameChange(previous, next, en.game),
    "The scoring proposal changed more than once. Review every marked group before confirming. The black group at C7 was marked dead (2 stones). The white group at G3 was marked dead (1 stone).",
  );
});

test("announces mixed scoring additions and restorations independently", () => {
  const board = createEmptyBoard(9);
  board[1][1] = "black";
  board[7][7] = "white";
  const scoring = {
    revision: 4,
    boardHash: "hash",
    stoppedMoveNumber: 8,
    deadStones: [{ x: 1, y: 1 }],
    blackConfirmed: false,
    whiteConfirmed: false,
    preview: {
      black: 1,
      white: 8.5,
      blackStones: 1,
      whiteStones: 1,
      blackTerritory: 0,
      whiteTerritory: 0,
      neutralPoints: 79,
      winner: "white" as const,
      margin: 7.5,
      result: "W+7.5",
    },
    finalizedAt: null,
    expiresAt: "2026-07-28T00:06:00.000Z",
  };
  const previous = game({ board, phase: "scoring", scoring });
  const next = game({
    board,
    phase: "scoring",
    scoring: { ...scoring, revision: 5, deadStones: [{ x: 7, y: 7 }] },
  });

  assert.equal(
    describeGameChange(previous, next, en.game),
    "The white group at H2 was marked dead (1 stone). The black group at B8 was restored as alive (1 stone).",
  );
});

test("announces a clock phase change without making the ticking clock live", () => {
  const previous = game();
  const next = game({
    clock: {
      ...previous.clock,
      black: {
        mainTimeMs: 0,
        periodsRemaining: 3,
        displayTimeMs: 30_000,
        phase: "byo-yomi",
      },
    },
  });

  assert.equal(
    describeGameChange(previous, next, en.game),
    "Black entered byo-yomi with 3 periods remaining.",
  );
});
