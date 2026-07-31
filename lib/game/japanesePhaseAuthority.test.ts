import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, boardHash, createEmptyBoard } from "./goEngine";
import {
  JapaneseNormalPlayReplayError,
  type JapanesePersistedMove,
} from "./japaneseKo";
import {
  JapanesePhaseAuthorityError,
  replayJapanesePhaseAuthority,
  type JapaneseResumeAuthorization,
} from "./japanesePhaseAuthority";
import {
  JAPANESE_1989_CONTRACT_ID,
  JAPANESE_1989_RULES_PROFILE,
} from "./japanesePolicyContract";
import { RULES_POLICIES } from "./rulesPolicy";
import type { BoardSize, Stone, StoredMove } from "./types";

function stored(
  moveNumber: number,
  color: Stone,
  x: number | null,
  y: number | null,
  isPass = false,
): StoredMove {
  return { moveNumber, color, x, y, isPass, createdAt: "" };
}

function withBoardHashes(
  size: BoardSize,
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

function twoPasses(): JapanesePersistedMove[] {
  return withBoardHashes(9, [
    stored(1, "black", null, null, true),
    stored(2, "white", null, null, true),
  ]);
}

function resumeAt(
  moves: readonly JapanesePersistedMove[],
  stoppedMoveNumber: number,
  requestedBy: Stone,
): JapaneseResumeAuthorization {
  return {
    stoppedMoveNumber,
    stoppedBoardHash: moves[stoppedMoveNumber - 1].boardHash,
    requestedBy,
  };
}

function expectPhaseError(
  action: () => unknown,
  code: JapanesePhaseAuthorityError["code"],
  moveNumber: number | null,
  authorizationIndex: number | null,
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof JapanesePhaseAuthorityError);
    assert.equal(error.code, code);
    assert.equal(error.moveNumber, moveNumber);
    assert.equal(error.authorizationIndex, authorizationIndex);
    return true;
  });
}

test("derives ordinary turn and pass authority without activating Japanese play", () => {
  const empty = replayJapanesePhaseAuthority(9, [], []);
  assert.deepEqual(empty.state, {
    phase: "play",
    toMove: "black",
    consecutivePasses: 0,
    stoppedAt: null,
  });

  const moves = withBoardHashes(9, [
    stored(1, "black", 0, 0),
    stored(2, "white", null, null, true),
  ]);
  const authority = replayJapanesePhaseAuthority(9, moves, []);
  assert.deepEqual(authority.state, {
    phase: "play",
    toMove: "black",
    consecutivePasses: 1,
    stoppedAt: null,
  });
  assert.equal(authority.contractId, JAPANESE_1989_CONTRACT_ID);
  assert.equal(authority.rulesProfile, JAPANESE_1989_RULES_PROFILE);
  assert.equal(authority.scope, "normal-play-phase-authority");
  assert.equal(Object.hasOwn(RULES_POLICIES, JAPANESE_1989_RULES_PROFILE), false);
});

test("requires alternating normal-play turns", () => {
  const moves = withBoardHashes(9, [
    stored(1, "black", 0, 0),
    stored(2, "black", 1, 0),
  ]);
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, moves, []),
    "invalid_turn",
    2,
    null,
  );
});

test("rejects White as the first normal-play actor", () => {
  const moves = withBoardHashes(9, [stored(1, "white", 0, 0)]);
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, moves, []),
    "invalid_turn",
    1,
    null,
  );
});

test("derives a stopped phase from two consecutive passes", () => {
  const moves = twoPasses();
  const authority = replayJapanesePhaseAuthority(9, moves, []);
  assert.deepEqual(authority.state, {
    phase: "stopped",
    toMove: null,
    consecutivePasses: 2,
    stoppedAt: {
      moveNumber: 2,
      boardHash: moves[1].boardHash,
    },
  });
  assert.equal(Object.isFrozen(authority.state), true);
  assert.equal(Object.isFrozen(authority.state.stoppedAt), true);
});

test("rejects a move after pass-pass without matching resume evidence", () => {
  const moves = withBoardHashes(9, [
    stored(1, "black", null, null, true),
    stored(2, "white", null, null, true),
    stored(3, "black", 0, 0),
  ]);
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, moves, []),
    "move_while_stopped",
    3,
    null,
  );
});

test("authorizes the requester's opponent to move first after resumption", () => {
  const moves = withBoardHashes(9, [
    stored(1, "black", null, null, true),
    stored(2, "white", null, null, true),
    stored(3, "white", 0, 0),
  ]);
  const authorization = resumeAt(moves, 2, "black");
  const authority = replayJapanesePhaseAuthority(9, moves, [authorization]);
  assert.deepEqual(authority.state, {
    phase: "play",
    toMove: "black",
    consecutivePasses: 0,
    stoppedAt: null,
  });
  assert.deepEqual(authority.resumeAuthorizations, [authorization]);

  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, withBoardHashes(9, [
      stored(1, "black", null, null, true),
      stored(2, "white", null, null, true),
      stored(3, "black", 0, 0),
    ]), [authorization]),
    "invalid_turn",
    3,
    null,
  );
});

test("a trailing resume authorization returns immediately to opponent-first play", () => {
  const moves = twoPasses();
  const authority = replayJapanesePhaseAuthority(9, moves, [resumeAt(moves, 2, "black")]);
  assert.deepEqual(authority.state, {
    phase: "play",
    toMove: "white",
    consecutivePasses: 0,
    stoppedAt: null,
  });
});

test("derives Black to move when White requests resumption", () => {
  const moves = withBoardHashes(9, [
    stored(1, "black", null, null, true),
    stored(2, "white", null, null, true),
    stored(3, "black", 0, 0),
  ]);
  const authority = replayJapanesePhaseAuthority(9, moves, [resumeAt(moves, 2, "white")]);
  assert.equal(authority.state.phase, "play");
  assert.equal(authority.state.toMove, "white");
});

test("resumption resets passes and supports repeated stopped phases", () => {
  const moves = withBoardHashes(9, [
    stored(1, "black", null, null, true),
    stored(2, "white", null, null, true),
    stored(3, "white", null, null, true),
    stored(4, "black", null, null, true),
    stored(5, "black", 0, 0),
  ]);
  const firstResume = resumeAt(moves, 2, "black");
  const stoppedAgain = replayJapanesePhaseAuthority(9, moves.slice(0, 4), [firstResume]);
  assert.deepEqual(stoppedAgain.state, {
    phase: "stopped",
    toMove: null,
    consecutivePasses: 2,
    stoppedAt: { moveNumber: 4, boardHash: moves[3].boardHash },
  });

  const secondResume = resumeAt(moves, 4, "white");
  const resumedAgain = replayJapanesePhaseAuthority(9, moves, [firstResume, secondResume]);
  assert.deepEqual(resumedAgain.state, {
    phase: "play",
    toMove: "white",
    consecutivePasses: 0,
    stoppedAt: null,
  });
});

test("binds resume evidence to the exact stopped board", () => {
  const moves = twoPasses();
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, moves, [{
      ...resumeAt(moves, 2, "black"),
      stoppedBoardHash: "tampered",
    }]),
    "resume_board_hash_mismatch",
    2,
    0,
  );
});

test("rejects resume evidence at a boundary that is not pass-pass", () => {
  const moves = withBoardHashes(9, [
    stored(1, "black", 0, 0),
    stored(2, "white", 1, 0),
  ]);
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, moves, [resumeAt(moves, 2, "black")]),
    "resume_without_stop",
    2,
    0,
  );
});

test("rejects resume evidence after only one pass", () => {
  const moves = withBoardHashes(9, [
    stored(1, "black", 0, 0),
    stored(2, "white", null, null, true),
  ]);
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, moves, [resumeAt(moves, 2, "black")]),
    "resume_without_stop",
    2,
    0,
  );
});

test("requires resume evidence to be ordered, unique, and fully consumed", () => {
  const moves = withBoardHashes(9, [
    stored(1, "black", null, null, true),
    stored(2, "white", null, null, true),
    stored(3, "white", null, null, true),
    stored(4, "black", null, null, true),
  ]);
  const first = resumeAt(moves, 2, "black");
  const second = resumeAt(moves, 4, "white");
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, moves, [second, first]),
    "invalid_resume_sequence",
    2,
    1,
  );
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, moves, [first, { ...first }]),
    "invalid_resume_sequence",
    2,
    1,
  );

  const stopped = twoPasses();
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, stopped, [{
      stoppedMoveNumber: 3,
      stoppedBoardHash: stopped[1].boardHash,
      requestedBy: "black",
    }]),
    "unconsumed_resume_authorization",
    3,
    0,
  );
});

test("rejects malformed and coercible resume authorization fields", () => {
  const moves = twoPasses();
  const baseline = resumeAt(moves, 2, "black");
  const malformed: readonly (readonly [unknown, number | null])[] = [
    [null, null],
    [[], null],
    [{ ...baseline, stoppedMoveNumber: "2" }, null],
    [{ ...baseline, stoppedMoveNumber: 2.5 }, null],
    [{ ...baseline, stoppedMoveNumber: Number.NaN }, null],
    [{ ...baseline, stoppedMoveNumber: 2_147_483_648 }, null],
    [{ ...baseline, stoppedBoardHash: "" }, 2],
    [{ ...baseline, stoppedBoardHash: new String(baseline.stoppedBoardHash) }, 2],
    [{ ...baseline, requestedBy: "red" }, 2],
    [{ ...baseline, requestedBy: new String("black") }, 2],
    [{ ...baseline, extra: true }, null],
  ];
  for (const [value, moveNumber] of malformed) {
    expectPhaseError(
      () => replayJapanesePhaseAuthority(
        9,
        moves,
        [value] as readonly JapaneseResumeAuthorization[],
      ),
      "invalid_resume_authorization",
      moveNumber,
      0,
    );
  }
});

test("requires dense arrays and exact own data fields without invoking accessors", () => {
  const moves = twoPasses();
  const baseline = resumeAt(moves, 2, "black");
  expectPhaseError(
    () => replayJapanesePhaseAuthority(
      9,
      moves,
      {} as readonly JapaneseResumeAuthorization[],
    ),
    "invalid_resume_authorizations",
    null,
    null,
  );
  const sparse = new Array(1) as JapaneseResumeAuthorization[];
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, moves, sparse),
    "invalid_resume_authorizations",
    null,
    0,
  );

  const inherited = Object.create(baseline) as JapaneseResumeAuthorization;
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, moves, [inherited]),
    "invalid_resume_authorization",
    null,
    0,
  );

  let getterCalls = 0;
  const accessor = {
    stoppedBoardHash: baseline.stoppedBoardHash,
    requestedBy: "black",
  } as Record<string, unknown>;
  Object.defineProperty(accessor, "stoppedMoveNumber", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 2;
    },
  });
  expectPhaseError(
    () => replayJapanesePhaseAuthority(
      9,
      moves,
      [accessor] as unknown as readonly JapaneseResumeAuthorization[],
    ),
    "invalid_resume_authorization",
    null,
    0,
  );
  assert.equal(getterCalls, 0);

  class ResumeList extends Array<JapaneseResumeAuthorization> {}
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, moves, new ResumeList(baseline)),
    "invalid_resume_authorizations",
    null,
    null,
  );

  const hostile = new Proxy([baseline], {
    ownKeys() {
      throw new Error("hostile ownKeys");
    },
  });
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, moves, hostile),
    "invalid_resume_authorizations",
    null,
    null,
  );
});

test("snapshots move evidence once before legality and phase replay", () => {
  const placements = withBoardHashes(9, [
    stored(1, "black", 0, 0),
    stored(2, "white", 1, 0),
  ]);
  const passes = twoPasses();
  let iteratorCalls = 0;
  const changingIterator = new Proxy(placements, {
    get(target, property, receiver) {
      if (property === Symbol.iterator) {
        iteratorCalls += 1;
        return iteratorCalls === 1
          ? passes[Symbol.iterator].bind(passes)
          : target[Symbol.iterator].bind(target);
      }
      return Reflect.get(target, property, receiver);
    },
  });

  const authority = replayJapanesePhaseAuthority(9, changingIterator, []);
  assert.equal(iteratorCalls, 0);
  assert.equal(authority.state.phase, "play");
  assert.equal(authority.state.toMove, "black");
  assert.equal(authority.normalPlay.board[0][0], "black");
  assert.equal(authority.normalPlay.board[0][1], "white");
});

test("retains Japanese simple-ko restrictions through stop and resume", () => {
  const setup: StoredMove[] = [
    stored(1, "black", 0, 1),
    stored(2, "white", 1, 1),
    stored(3, "black", 2, 1),
    stored(4, "white", 0, 2),
    stored(5, "black", 1, 0),
    stored(6, "white", 2, 2),
    stored(7, "black", 8, 8),
    stored(8, "white", 1, 3),
    stored(9, "black", 1, 2),
    stored(10, "white", null, null, true),
    stored(11, "black", null, null, true),
  ];
  const stopped = withBoardHashes(9, setup);
  const authorization = resumeAt(stopped, 11, "black");

  const immediateRecapture = withBoardHashes(9, [
    ...setup,
    stored(12, "white", 1, 1),
  ]);
  assert.throws(
    () => replayJapanesePhaseAuthority(9, immediateRecapture, [authorization]),
    (error: unknown) => error instanceof JapaneseNormalPlayReplayError
      && error.code === "illegal_move"
      && error.moveNumber === 12
      && /ko/.test(error.message),
  );

  const recaptureAfterElsewhere = withBoardHashes(9, [
    ...setup,
    stored(12, "white", 7, 7),
    stored(13, "black", null, null, true),
    stored(14, "white", 1, 1),
  ]);
  const legal = replayJapanesePhaseAuthority(9, recaptureAfterElsewhere, [authorization]);
  assert.equal(legal.state.phase, "play");
  assert.equal(legal.state.toMove, "black");
});

test("rejects malformed move numbers before caller-controlled coercion", () => {
  const moves = twoPasses();
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, [{
      ...moves[0],
      moveNumber: "1" as unknown as number,
    }], []),
    "invalid_move_record",
    null,
    null,
  );

  let coercionCalls = 0;
  const hostileMoveNumber = {
    toString() {
      coercionCalls += 1;
      throw new Error("hostile toString");
    },
    valueOf() {
      coercionCalls += 1;
      throw new Error("hostile valueOf");
    },
  };
  expectPhaseError(
    () => replayJapanesePhaseAuthority(9, [{
      ...moves[0],
      moveNumber: hostileMoveNumber as unknown as number,
    }], []),
    "invalid_move_record",
    null,
    null,
  );
  assert.equal(coercionCalls, 0);
});

test("preserves upstream validation for malformed board hashes", () => {
  const moves = twoPasses();
  assert.throws(
    () => replayJapanesePhaseAuthority(9, [{ ...moves[0], boardHash: "tampered" }], []),
    (error: unknown) => error instanceof JapaneseNormalPlayReplayError
      && error.code === "board_hash_mismatch",
  );
});

test("returns deeply frozen authority without mutating caller evidence", () => {
  const moves = withBoardHashes(9, [
    stored(1, "black", null, null, true),
    stored(2, "white", null, null, true),
    stored(3, "white", 0, 0),
  ]);
  const authorization = resumeAt(moves, 2, "black");
  const moveSnapshot = structuredClone(moves);
  const authorizationSnapshot = structuredClone(authorization);
  const authority = replayJapanesePhaseAuthority(9, moves, [authorization]);

  assert.deepEqual(moves, moveSnapshot);
  assert.deepEqual(authorization, authorizationSnapshot);
  assert.equal(Object.isFrozen(authority), true);
  assert.equal(Object.isFrozen(authority.state), true);
  assert.equal(Object.isFrozen(authority.normalPlay), true);
  assert.equal(Object.isFrozen(authority.normalPlay.board), true);
  assert.equal(Object.isFrozen(authority.resumeAuthorizations), true);
  assert.equal(Object.isFrozen(authority.resumeAuthorizations[0]), true);
  assert.notEqual(authority.resumeAuthorizations[0], authorization);
  if (false) {
    // @ts-expect-error returned authority is readonly
    authority.state = { phase: "play", toMove: "black", consecutivePasses: 0, stoppedAt: null };
    // @ts-expect-error resume evidence is readonly
    authority.resumeAuthorizations[0].requestedBy = "white";
  }
});
