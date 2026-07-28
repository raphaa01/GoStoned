import assert from "node:assert/strict";
import test from "node:test";
import {
  JapaneseNormalPlayReplayError,
  replayJapaneseNormalPlayBoardLegality,
  type JapanesePersistedMove,
} from "./japaneseKo";
import {
  applyMove,
  boardHash,
  createEmptyBoard,
  replayMovesWithPrisoners,
} from "./goEngine";
import {
  JAPANESE_1989_CONTRACT_ID,
  JAPANESE_1989_RULES_PROFILE,
} from "./japanesePolicyContract";
import type { Stone, StoredMove } from "./types";

function stored(
  moveNumber: number,
  color: Stone,
  x: number | null,
  y: number | null,
  isPass = false,
): StoredMove {
  return { moveNumber, color, x, y, isPass, createdAt: "" };
}

function append(
  moves: StoredMove[],
  color: Stone,
  x: number | null,
  y: number | null,
  isPass = false,
): void {
  moves.push(stored(moves.length + 1, color, x, y, isPass));
}

function appendClassicKoSetup(
  moves: StoredMove[],
  capturingColor: Stone,
  capturedX: number,
  capturedY: number,
): Readonly<{
  capturingMove: Readonly<{ x: number; y: number }>;
  recapturePoint: Readonly<{ x: number; y: number }>;
}> {
  const capturedColor = capturingColor === "black" ? "white" : "black";
  append(moves, capturedColor, capturedX, capturedY);
  append(moves, capturingColor, capturedX - 1, capturedY);
  append(moves, capturingColor, capturedX + 1, capturedY);
  append(moves, capturingColor, capturedX, capturedY - 1);
  append(moves, capturedColor, capturedX - 1, capturedY + 1);
  append(moves, capturedColor, capturedX + 1, capturedY + 1);
  append(moves, capturedColor, capturedX, capturedY + 2);
  return {
    capturingMove: { x: capturedX, y: capturedY + 1 },
    recapturePoint: { x: capturedX, y: capturedY },
  };
}

function withBoardHashes(
  size: 9 | 13 | 19,
  moves: readonly StoredMove[],
): JapanesePersistedMove[] {
  let board = createEmptyBoard(size);
  return moves.map((move) => {
    if (!move.isPass) {
      if (move.x === null || move.y === null) throw new Error("Test move has no coordinates.");
      const result = applyMove(board, move.color, move.x, move.y);
      if (!result.ok) throw new Error(`Test move is invalid (${result.error}).`);
      board = result.board;
    }
    return { ...move, boardHash: boardHash(board) };
  });
}

function expectReplayError(
  action: () => unknown,
  code: JapaneseNormalPlayReplayError["code"],
  moveNumber: number | null,
  message?: RegExp,
): void {
  assert.throws(action, (error) => {
    assert.ok(error instanceof JapaneseNormalPlayReplayError);
    assert.equal(error.code, code);
    assert.equal(error.moveNumber, moveNumber);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test("identifies exact center ko and rejects immediate recapture", () => {
  const moves: StoredMove[] = [];
  const ko = appendClassicKoSetup(moves, "black", 1, 1);
  append(moves, "black", ko.capturingMove.x, ko.capturingMove.y);
  const persisted = withBoardHashes(9, moves);
  const capture = replayJapaneseNormalPlayBoardLegality(9, persisted);

  assert.deepEqual(capture.koRestrictions, [{
    prohibitedPlayer: "white",
    recapturePoint: { x: 1, y: 1 },
    capturingStone: { x: 1, y: 2 },
    createdByMoveNumber: 8,
    boardBeforeCaptureHash: capture.positionHistory[7],
  }]);

  append(moves, "white", ko.recapturePoint.x, ko.recapturePoint.y);
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, withBoardHashes(9, moves)),
    "illegal_move",
    9,
    /invalid \(ko\)/,
  );
});

test("detects mirrored-color and corner ko without boundary assumptions", () => {
  const mirrored: StoredMove[] = [];
  const mirroredKo = appendClassicKoSetup(mirrored, "white", 1, 1);
  append(mirrored, "white", mirroredKo.capturingMove.x, mirroredKo.capturingMove.y);
  const mirroredReplay = replayJapaneseNormalPlayBoardLegality(
    9,
    withBoardHashes(9, mirrored),
  );
  assert.equal(mirroredReplay.koRestrictions[0].prohibitedPlayer, "black");

  const corner: StoredMove[] = [];
  append(corner, "white", 0, 0);
  append(corner, "black", 1, 0);
  append(corner, "white", 1, 1);
  append(corner, "white", 0, 2);
  append(corner, "black", 0, 1);
  const cornerReplay = replayJapaneseNormalPlayBoardLegality(9, withBoardHashes(9, corner));
  assert.deepEqual(cornerReplay.koRestrictions.map((restriction) => ({
    prohibitedPlayer: restriction.prohibitedPlayer,
    recapturePoint: restriction.recapturePoint,
    capturingStone: restriction.capturingStone,
  })), [{
    prohibitedPlayer: "white",
    recapturePoint: { x: 0, y: 0 },
    capturingStone: { x: 0, y: 1 },
  }]);
});

test("does not misclassify multi-stone, connected, or snapback captures", () => {
  const multi = [
    stored(1, "white", 0, 0),
    stored(2, "white", 1, 0),
    stored(3, "black", 0, 1),
    stored(4, "black", 1, 1),
    stored(5, "black", 2, 0),
  ];
  assert.deepEqual(
    replayJapaneseNormalPlayBoardLegality(9, withBoardHashes(9, multi)).koRestrictions,
    [],
  );

  const connected = [
    stored(1, "white", 0, 0),
    stored(2, "black", 1, 0),
    stored(3, "black", 1, 1),
    stored(4, "black", 0, 1),
  ];
  assert.deepEqual(
    replayJapaneseNormalPlayBoardLegality(9, withBoardHashes(9, connected)).koRestrictions,
    [],
  );

  const snapback = [
    stored(1, "black", 0, 0),
    stored(2, "black", 3, 0),
    stored(3, "black", 2, 1),
    stored(4, "white", 2, 0),
    stored(5, "white", 0, 1),
    stored(6, "white", 1, 1),
    stored(7, "black", 1, 0),
  ];
  const snapbackCapture = replayJapaneseNormalPlayBoardLegality(
    9,
    withBoardHashes(9, snapback),
  );
  assert.deepEqual(snapbackCapture.prisoners, {
    capturedWhiteByBlack: 1,
    capturedBlackByWhite: 0,
  });
  assert.deepEqual(snapbackCapture.koRestrictions, []);
  append(snapback, "white", 2, 0);
  const recapture = replayJapaneseNormalPlayBoardLegality(9, withBoardHashes(9, snapback));
  assert.deepEqual(recapture.prisoners, {
    capturedWhiteByBlack: 1,
    capturedBlackByWhite: 2,
  });
});

test("pass preserves a ko ban until its prohibited player places elsewhere", () => {
  const blocked: StoredMove[] = [];
  const ko = appendClassicKoSetup(blocked, "black", 1, 1);
  append(blocked, "black", ko.capturingMove.x, ko.capturingMove.y);
  append(blocked, "white", null, null, true);
  append(blocked, "black", 8, 8);
  append(blocked, "white", ko.recapturePoint.x, ko.recapturePoint.y);
  const blockedHashes = withBoardHashes(9, blocked);
  assert.equal(blockedHashes[8].boardHash, blockedHashes[7].boardHash);
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, blockedHashes),
    "illegal_move",
    11,
    /invalid \(ko\)/,
  );

  const cleared = blocked.slice(0, -1);
  append(cleared, "white", 7, 8);
  append(cleared, "black", 8, 7);
  append(cleared, "white", ko.recapturePoint.x, ko.recapturePoint.y);
  const replay = replayJapaneseNormalPlayBoardLegality(9, withBoardHashes(9, cleared));
  assert.equal(replay.board[1][1], "white");
  assert.equal(replay.board[2][1], null);
  assert.deepEqual(replay.prisoners, {
    capturedWhiteByBlack: 1,
    capturedBlackByWhite: 1,
  });
});

test("illegal elsewhere attempts cannot consume a persisted ko restriction", () => {
  const legalPrefix: StoredMove[] = [];
  const ko = appendClassicKoSetup(legalPrefix, "black", 1, 1);
  append(legalPrefix, "black", ko.capturingMove.x, ko.capturingMove.y);
  for (const point of [
    { x: 5, y: 6 }, { x: 7, y: 6 }, { x: 6, y: 5 }, { x: 6, y: 7 },
  ]) append(legalPrefix, "black", point.x, point.y);
  const persistedPrefix = withBoardHashes(9, legalPrefix);

  for (const [x, y, error] of [
    [0, 1, "occupied"],
    [-1, 0, "out_of_bounds"],
    [6, 6, "suicide"],
  ] as const) {
    expectReplayError(
      () => replayJapaneseNormalPlayBoardLegality(9, [
        ...persistedPrefix,
        { ...stored(13, "white", x, y), boardHash: "unreachable" },
      ]),
      "illegal_move",
      13,
      new RegExp(`invalid \\(${error}\\)`),
    );
  }

  const recapture = [...legalPrefix];
  append(recapture, "white", ko.recapturePoint.x, ko.recapturePoint.y);
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, withBoardHashes(9, recapture)),
    "illegal_move",
    13,
    /invalid \(ko\)/,
  );
});

test("records an exact triple-ko cycle instead of applying positional superko", () => {
  const blackSetup = [
    { x: 2, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 5 },
    { x: 8, y: 3 }, { x: 10, y: 3 }, { x: 9, y: 2 }, { x: 9, y: 4 },
    { x: 14, y: 4 }, { x: 16, y: 4 }, { x: 15, y: 5 },
  ];
  const whiteSetup = [
    { x: 3, y: 4 }, { x: 2, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 2 },
    { x: 8, y: 4 }, { x: 10, y: 4 }, { x: 9, y: 5 },
    { x: 15, y: 4 }, { x: 14, y: 3 }, { x: 16, y: 3 }, { x: 15, y: 2 },
  ];
  const moves: StoredMove[] = [stored(1, "black", null, null, true)];
  for (let index = 0; index < whiteSetup.length; index += 1) {
    append(moves, "white", whiteSetup[index].x, whiteSetup[index].y);
    const black = blackSetup[index];
    if (black) append(moves, "black", black.x, black.y);
  }
  assert.equal(moves.length, 22);
  for (const [color, point] of [
    ["black", { x: 3, y: 3 }],
    ["white", { x: 9, y: 3 }],
    ["black", { x: 15, y: 3 }],
    ["white", { x: 3, y: 4 }],
    ["black", { x: 9, y: 4 }],
    ["white", { x: 15, y: 4 }],
  ] as const) append(moves, color, point.x, point.y);

  const replay = replayJapaneseNormalPlayBoardLegality(19, withBoardHashes(19, moves));
  assert.equal(replay.positionHistory[22], replay.positionHistory[28]);
  assert.deepEqual(replay.prisoners, {
    capturedWhiteByBlack: 3,
    capturedBlackByWhite: 3,
  });
  assert.deepEqual(replay.koRestrictions.map((restriction) => ({
    prohibitedPlayer: restriction.prohibitedPlayer,
    recapturePoint: restriction.recapturePoint,
  })), [{
    prohibitedPlayer: "black",
    recapturePoint: { x: 15, y: 3 },
  }]);
});

test("retains multiple bans until their prohibited player places elsewhere", () => {
  const moves: StoredMove[] = [];
  const first = appendClassicKoSetup(moves, "black", 3, 3);
  const second = appendClassicKoSetup(moves, "black", 15, 3);
  append(moves, "black", first.capturingMove.x, first.capturingMove.y);
  append(moves, "white", null, null, true);
  append(moves, "black", null, null, true);
  append(moves, "black", second.capturingMove.x, second.capturingMove.y);
  const replay = replayJapaneseNormalPlayBoardLegality(19, withBoardHashes(19, moves));
  assert.deepEqual(
    replay.koRestrictions.map((restriction) => restriction.recapturePoint),
    [first.recapturePoint, second.recapturePoint],
  );

  for (const point of [first.recapturePoint, second.recapturePoint]) {
    const recapture = [...moves];
    append(recapture, "white", point.x, point.y);
    expectReplayError(
      () => replayJapaneseNormalPlayBoardLegality(19, withBoardHashes(19, recapture)),
      "illegal_move",
      19,
      /invalid \(ko\)/,
    );
  }

  append(moves, "white", 9, 9);
  assert.deepEqual(
    replayJapaneseNormalPlayBoardLegality(19, withBoardHashes(19, moves)).koRestrictions,
    [],
  );
});

test("fails closed for malformed persisted Japanese records and hashes", () => {
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, withBoardHashes(9, [stored(2, "black", 0, 0)])),
    "invalid_move_sequence",
    2,
  );
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, withBoardHashes(9, [
      stored(1, "black", 0, 0), stored(3, "white", 1, 0),
    ])),
    "invalid_move_sequence",
    3,
  );
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, withBoardHashes(9, [
      stored(1, "black", 0, 0), stored(1, "white", 1, 0),
    ])),
    "invalid_move_sequence",
    1,
  );
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, [{
      ...stored(1, "black", 0, 0, true), boardHash: boardHash(createEmptyBoard(9)),
    }]),
    "invalid_pass_coordinates",
    1,
  );
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, [{
      ...stored(1, "black", null, null), boardHash: boardHash(createEmptyBoard(9)),
    }]),
    "missing_coordinates",
    1,
  );
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, [{
      ...stored(1, "black", 0, 0), color: "red" as Stone, boardHash: "invalid",
    }]),
    "invalid_color",
    1,
  );
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, [{
      ...stored(1, "black", 0, 0),
      isPass: null as unknown as boolean,
      boardHash: "invalid",
    }]),
    "invalid_pass_flag",
    1,
  );
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, [{
      ...stored(1, "black", 0.5, 0), boardHash: "invalid",
    }]),
    "invalid_coordinates",
    1,
  );
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, [{
      ...stored(1, "black", -1, 0), boardHash: "invalid",
    }]),
    "illegal_move",
    1,
    /out_of_bounds/,
  );
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(10 as 9, []),
    "invalid_board_size",
    null,
  );
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, [{
      ...stored(1, "black", 0, 0), boardHash: "",
    }]),
    "missing_board_hash",
    1,
  );
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, [{
      ...stored(1, "black", 0, 0), boardHash: "tampered",
    }]),
    "board_hash_mismatch",
    1,
  );
  expectReplayError(
    () => replayJapaneseNormalPlayBoardLegality(9, [{
      ...stored(1, "black", null, null, true), boardHash: "tampered-pass",
    }]),
    "board_hash_mismatch",
    1,
  );
});

test("leaves active Chinese structural replay behavior unchanged", () => {
  const moves: StoredMove[] = [];
  const ko = appendClassicKoSetup(moves, "black", 1, 1);
  append(moves, "black", ko.capturingMove.x, ko.capturingMove.y);
  append(moves, "white", ko.recapturePoint.x, ko.recapturePoint.y);
  assert.deepEqual(replayMovesWithPrisoners(9, moves).prisoners, {
    capturedWhiteByBlack: 1,
    capturedBlackByWhite: 1,
  });
});

test("returns contract-tagged immutable authority state without mutating input", () => {
  const moves: StoredMove[] = [];
  const ko = appendClassicKoSetup(moves, "black", 1, 1);
  append(moves, "black", ko.capturingMove.x, ko.capturingMove.y);
  const persisted = withBoardHashes(9, moves);
  const snapshot = structuredClone(persisted);
  const replay = replayJapaneseNormalPlayBoardLegality(9, persisted);

  assert.deepEqual(persisted, snapshot);
  assert.equal(replay.contractId, JAPANESE_1989_CONTRACT_ID);
  assert.equal(replay.rulesProfile, JAPANESE_1989_RULES_PROFILE);
  assert.equal(replay.scope, "normal-play-board-legality");
  assert.equal(Object.isFrozen(replay), true);
  assert.equal(Object.isFrozen(replay.board), true);
  assert.equal(replay.board.every(Object.isFrozen), true);
  if (false) {
    // @ts-expect-error replay authority state is deeply readonly
    replay.board[0][0] = "black";
  }
  assert.equal(Object.isFrozen(replay.prisoners), true);
  assert.equal(Object.isFrozen(replay.positionHistory), true);
  assert.equal(Object.isFrozen(replay.koRestrictions), true);
  assert.equal(Object.isFrozen(replay.koRestrictions[0]), true);
  assert.equal(Object.isFrozen(replay.koRestrictions[0].recapturePoint), true);
  assert.equal(Object.isFrozen(replay.koRestrictions[0].capturingStone), true);
  assert.equal(replay.positionHistory.length, moves.length + 1);
  assert.equal(replay.positionHistory.at(-1), persisted.at(-1)?.boardHash);
});
