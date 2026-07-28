import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  confirmScore,
  GameServiceError,
  getGameState,
  pollGameState,
  resignGame,
  resumePlay,
  submitMove,
} from "./gameService";
import { applyMove, boardHash, createEmptyBoard } from "./goEngine";
import type { GameState, Stone, StoredMove } from "./types";

const gameId = "11111111-1111-4111-8111-111111111111";
const blackKey = "guest:black";
const whiteKey = "guest:white";
const blackUserKey = "user:22222222-2222-4222-8222-222222222222";
const whiteUserKey = "user:33333333-3333-4333-8333-333333333333";
const emptyBoardHash = boardHash(createEmptyBoard(9));

function emptyBoardPassRows() {
  return [
    {
      move_number: 1,
      color: "black",
      x: null,
      y: null,
      is_pass: true,
      board_hash: emptyBoardHash,
      created_at: new Date("2099-01-01T00:01:00.000Z"),
    },
    {
      move_number: 2,
      color: "white",
      x: null,
      y: null,
      is_pass: true,
      board_hash: emptyBoardHash,
      created_at: new Date("2099-01-01T00:02:00.000Z"),
    },
  ];
}

function persistedMoveRows(
  moves: readonly StoredMove[],
  hashMode: "computed" | "missing" = "computed",
) {
  let board = createEmptyBoard(9);
  return moves.map((move) => {
    if (!move.isPass) {
      const result = applyMove(board, move.color, move.x!, move.y!);
      if (!result.ok) throw new Error(`Invalid test move (${result.error}).`);
      board = result.board;
    }
    return {
      move_number: move.moveNumber,
      color: move.color,
      x: move.x,
      y: move.y,
      is_pass: move.isPass,
      board_hash: hashMode === "computed" ? boardHash(board) : null,
      created_at: new Date(`2099-01-01T00:${String(move.moveNumber).padStart(2, "0")}:00.000Z`),
    };
  });
}

function storedMove(
  moveNumber: number,
  color: Stone,
  x: number | null,
  y: number | null,
  isPass = false,
): StoredMove {
  return { moveNumber, color, x, y, isPass, createdAt: "" };
}

function gameRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2099-01-01T00:00:00.000Z");
  return {
    id: gameId,
    board_size: 9,
    black_player_key: blackKey,
    white_player_key: "guest:white",
    black_player_name: "Black",
    white_player_name: "White",
    winner_key: null,
    rated: false,
    status: "active",
    phase: "play",
    to_move: "black",
    consecutive_passes: 0,
    scoring_revision: 0,
    result: null,
    finish_reason: null,
    last_resume_claim: null,
    last_resume_by: null,
    last_resume_x: null,
    last_resume_y: null,
    komi: "7.5",
    rules: "chinese",
    rules_profile: "chinese-2002-gostone-v1",
    scoring_method: "area",
    handicap: 0,
    time_control: "rapid",
    main_time_seconds: 600,
    byo_yomi_periods: 5,
    byo_yomi_seconds: 30,
    black_time_remaining_ms: 600_000,
    white_time_remaining_ms: 600_000,
    black_periods_remaining: 5,
    white_periods_remaining: 5,
    turn_started_at: now,
    version: 0,
    started_at: now,
    finished_at: null,
    ...overrides,
  };
}

function scoringRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2099-01-01T00:00:00.000Z");
  return {
    game_id: gameId,
    board_hash: emptyBoardHash,
    stopped_move_number: 2,
    revision: 1,
    rules: "chinese",
    rules_profile: "chinese-2002-gostone-v1",
    scoring_method: "area",
    komi: "7.5",
    handicap: 0,
    fallback_to_move: "black",
    expires_at: new Date("2099-01-01T00:10:00.000Z"),
    black_confirmed_revision: null,
    white_confirmed_revision: null,
    black_confirmed_at: null,
    white_confirmed_at: null,
    scored_board_hash: null,
    black_stones: null,
    white_stones: null,
    black_territory: null,
    white_territory: null,
    neutral_points: null,
    black_dead_stones: null,
    white_dead_stones: null,
    black_total: null,
    white_total: null,
    result: null,
    started_at: now,
    updated_at: now,
    finalized_at: null,
    ...overrides,
  };
}

const finalizedAt = new Date("2099-01-01T00:05:00.000Z");

function finishedScoredGame(overrides: Record<string, unknown> = {}) {
  return gameRow({
    status: "finished",
    phase: "scoring",
    to_move: null,
    scoring_revision: 1,
    winner_key: "guest:white",
    result: "W+7.5",
    finish_reason: "score",
    finished_at: finalizedAt,
    ...overrides,
  });
}

function finalizedScoringRow(overrides: Record<string, unknown> = {}) {
  return scoringRow({
    black_confirmed_revision: 1,
    white_confirmed_revision: 1,
    black_confirmed_at: finalizedAt,
    white_confirmed_at: finalizedAt,
    scored_board_hash: emptyBoardHash,
    black_stones: 0,
    white_stones: 0,
    black_territory: 0,
    white_territory: 0,
    neutral_points: 81,
    black_dead_stones: 0,
    white_dead_stones: 0,
    black_total: "40.5",
    white_total: "48.0",
    result: "W+7.5",
    finalized_at: finalizedAt,
    ...overrides,
  });
}

async function withFakeDatabase(
  rows: {
    game: Record<string, unknown>;
    scoring: Record<string, unknown> | null;
    deadRows?: Record<string, unknown>[];
    moveRows?: Record<string, unknown>[];
    allowMoveWrite?: boolean;
  },
  action: () => Promise<unknown>,
): Promise<string[]> {
  const statements: string[] = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      statements.push(sql);
      if (sql === "BEGIN" || sql.startsWith("SET LOCAL") || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM games g")) return { rows: [rows.game], rowCount: 1 };
      if (sql.includes("FROM moves")) {
        const moveRows = rows.moveRows ?? (rows.scoring ? emptyBoardPassRows() : []);
        return { rows: moveRows, rowCount: moveRows.length };
      }
      if (sql.includes("FROM game_scoring_state")) {
        return { rows: rows.scoring ? [rows.scoring] : [], rowCount: rows.scoring ? 1 : 0 };
      }
      if (sql.includes("FROM game_dead_stones")) {
        const deadRows = rows.deadRows ?? [];
        return { rows: deadRows, rowCount: deadRows.length };
      }
      if (rows.allowMoveWrite && sql.includes("INSERT INTO moves")) {
        const inserted = {
          move_number: values[1],
          color: values[2],
          x: values[3],
          y: values[4],
          is_pass: values[5],
          board_hash: values[6],
          created_at: new Date("2099-01-01T00:02:00.000Z"),
        };
        return { rows: [inserted], rowCount: 1 };
      }
      if (
        rows.allowMoveWrite
        && sql.includes("UPDATE games")
        && sql.includes("SET to_move = $2")
      ) {
        assert.match(sql, /turn_started_at = \$8, updated_at = \$9/);
        assert.equal(values.length, 9);
        assert.equal(values[7], values[8]);
        return {
          rows: [{
            ...rows.game,
            to_move: values[1],
            consecutive_passes: values[2],
            black_time_remaining_ms: values[3],
            white_time_remaining_ms: values[4],
            black_periods_remaining: values[5],
            white_periods_remaining: values[6],
            turn_started_at: values[7],
            version: Number(rows.game.version) + 1,
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected database statement in fail-closed test: ${sql}`);
    },
    release() {},
  };
  const previousPool = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = {
    query: client.query,
    connect: async () => client,
  } as unknown as Pool;

  try {
    await action();
  } finally {
    globalThis.goStonedDbPool = previousPool;
  }
  return statements;
}

async function assertRejectedWithoutWrites(
  rows: {
    game: Record<string, unknown>;
    scoring: Record<string, unknown> | null;
    deadRows?: Record<string, unknown>[];
    moveRows?: Record<string, unknown>[];
    allowMoveWrite?: boolean;
  },
  expectedCode: string,
  action: () => Promise<unknown>,
  expectedStatus = 500,
) {
  let rejection: unknown;
  const statements = await withFakeDatabase(rows, async () => {
    try {
      await action();
    } catch (error) {
      rejection = error;
    }
  });
  assert.ok(rejection instanceof GameServiceError);
  assert.equal(rejection.status, expectedStatus);
  assert.equal(rejection.code, expectedCode);
  assert.deepEqual(
    statements.filter((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql)),
    [],
  );
  assert.equal(statements.includes("ROLLBACK"), true);
  assert.equal(statements.includes("COMMIT"), false);
}

test("move versions are bounded and stale intents fail before gameplay writes", async (t) => {
  for (const [name, expectedVersion] of [
    ["missing", undefined],
    ["fractional", 0.5],
    ["negative", -1],
    ["PostgreSQL integer overflow", 2_147_483_648],
  ] as const) {
    await t.test(name, async () => {
      await assertRejectedWithoutWrites(
        { game: gameRow({ version: 0 }), scoring: null },
        "invalid_game_mutation_request",
        () => submitMove(gameId, blackKey, {
          x: 0,
          y: 0,
          expectedVersion: expectedVersion as number,
        }),
        400,
      );
    });
  }

  await t.test("stale placement", async () => {
    const statements: string[] = [];
    let rejection: unknown;
    statements.push(...await withFakeDatabase(
      { game: gameRow({ version: 8 }), scoring: null, allowMoveWrite: true },
      async () => {
        try {
          await submitMove(gameId, blackKey, { x: 0, y: 0, expectedVersion: 7 });
        } catch (error) {
          rejection = error;
        }
      },
    ));
    assert.ok(rejection instanceof GameServiceError);
    assert.equal(rejection.status, 409);
    assert.equal(rejection.code, "game_version_conflict");
    assert.equal(statements.some((sql) => sql.includes("FOR UPDATE OF g")), true);
    assert.deepEqual(
      statements.filter((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql)),
      [],
    );
    assert.equal(statements.at(-1), "ROLLBACK");
  });

  await t.test("stale pass", async () => {
    await assertRejectedWithoutWrites(
      { game: gameRow({ version: 2 }), scoring: null, allowMoveWrite: true },
      "game_version_conflict",
      () => submitMove(gameId, blackKey, { isPass: true, expectedVersion: 1 }),
      409,
    );
  });
});

test("move clock timestamps bind separate PostgreSQL parameter types", async () => {
  const statements = await withFakeDatabase(
    { game: gameRow(), scoring: null, allowMoveWrite: true },
    () => submitMove(gameId, blackKey, { x: 0, y: 0, expectedVersion: 0 }),
  );
  const clockUpdate = statements.find(
    (sql) => sql.includes("UPDATE games") && sql.includes("SET to_move = $2"),
  );
  assert.ok(clockUpdate);
  assert.match(clockUpdate, /turn_started_at = \$8, updated_at = \$9/);
});

async function loadState(
  game: Record<string, unknown>,
  scoring: Record<string, unknown> | null,
  moveRows?: Record<string, unknown>[],
): Promise<GameState> {
  let state: GameState | undefined;
  const statements = await withFakeDatabase({ game, scoring, moveRows }, async () => {
    state = await getGameState(gameId, blackKey);
  });
  assert.ok(state);
  assert.equal(statements.includes("COMMIT"), true);
  assert.equal(statements.includes("ROLLBACK"), false);
  return state;
}

test("version-aware polling skips replay only when wall-time transitions are safe", async (t) => {
  await t.test("matching current-profile play returns a fresh clock without locks or moves", async () => {
    let result: Awaited<ReturnType<typeof pollGameState>> | undefined;
    const statements = await withFakeDatabase(
      { game: gameRow({ version: 7 }), scoring: null },
      async () => {
        result = await pollGameState(gameId, blackKey, 7);
      },
    );
    assert.ok(result?.unchanged);
    assert.equal(result.gameId, gameId);
    assert.equal(result.version, 7);
    assert.equal(result.clock.black.phase, "main");
    assert.equal(statements.some((sql) => sql.includes("FROM moves")), false);
    assert.equal(statements.some((sql) => sql.includes("FOR UPDATE")), false);
    assert.equal(statements.includes("BEGIN"), false);
    assert.equal(statements.includes("COMMIT"), false);
    assert.equal(
      statements.some((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql)),
      false,
    );
  });

  await t.test("a stale or future version receives the fully verified state", async () => {
    for (const knownVersion of [6, 8]) {
      let result: Awaited<ReturnType<typeof pollGameState>> | undefined;
      const statements = await withFakeDatabase(
        { game: gameRow({ version: 7 }), scoring: null },
        async () => {
          result = await pollGameState(gameId, blackKey, knownVersion);
        },
      );
      assert.ok(result && !result.unchanged);
      assert.equal(result.game.version, 7);
      assert.equal(statements.some((sql) => sql.includes("FROM moves")), true);
      assert.equal(statements.some((sql) => sql.includes("FOR UPDATE OF g")), true);
    }
  });

  await t.test("matching finished state still receives the fully verified outcome", async () => {
    let result: Awaited<ReturnType<typeof pollGameState>> | undefined;
    const statements = await withFakeDatabase(
      { game: finishedScoredGame({ version: 9 }), scoring: finalizedScoringRow() },
      async () => {
        result = await pollGameState(gameId, blackKey, 9);
      },
    );
    assert.ok(result && !result.unchanged);
    assert.equal(result.game.status, "finished");
    assert.equal(statements.some((sql) => sql.includes("FROM moves")), true);
    assert.equal(statements.some((sql) => sql.includes("game_scoring_state")), true);
    assert.equal(statements.some((sql) => sql.includes("FOR UPDATE OF g")), true);
  });

  await t.test("matching malformed active and finished headers cannot return heartbeats", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({
          version: 7,
          result: "B+R",
          winner_key: blackKey,
          finished_at: finalizedAt,
        }),
        scoring: null,
      },
      "game_outcome_mismatch",
      () => pollGameState(gameId, blackKey, 7),
    );
    await assertRejectedWithoutWrites(
      {
        game: gameRow({
          version: 9,
          status: "finished",
          phase: "play",
          to_move: null,
          result: "W+T",
          winner_key: blackKey,
          finish_reason: "resignation",
          finished_at: finalizedAt,
        }),
        scoring: null,
      },
      "game_outcome_mismatch",
      () => pollGameState(gameId, blackKey, 9),
    );
  });

  await t.test("matching unexpired scoring reads only its deadline header", async () => {
    let result: Awaited<ReturnType<typeof pollGameState>> | undefined;
    const statements = await withFakeDatabase(
      {
        game: gameRow({ phase: "scoring", to_move: null, scoring_revision: 1, version: 4 }),
        scoring: scoringRow(),
      },
      async () => {
        result = await pollGameState(gameId, blackKey, 4);
      },
    );
    assert.ok(result?.unchanged);
    assert.equal(statements.some((sql) => sql.includes("FROM moves")), false);
    assert.equal(
      statements.some((sql) => sql.includes("FROM game_scoring_state scoring")),
      true,
    );
    assert.equal(statements.some((sql) => sql.includes("FOR UPDATE")), false);
  });

  await t.test("legacy play falls through because its turn is move-log authoritative", async () => {
    let result: Awaited<ReturnType<typeof pollGameState>> | undefined;
    const statements = await withFakeDatabase(
      {
        game: gameRow({ rules_profile: "legacy-immediate-area", to_move: null, version: 3 }),
        scoring: null,
      },
      async () => {
        result = await pollGameState(gameId, blackKey, 3);
      },
    );
    assert.ok(result && !result.unchanged);
    assert.equal(statements.some((sql) => sql.includes("FROM moves")), true);
  });

  await t.test("an outsider is rejected before version or dependent state is exposed", async () => {
    let rejection: unknown;
    const statements = await withFakeDatabase(
      { game: gameRow({ version: 7 }), scoring: null },
      async () => {
        try {
          await pollGameState(gameId, "guest:attacker", 7);
        } catch (error) {
          rejection = error;
        }
      },
    );
    assert.ok(rejection instanceof GameServiceError);
    assert.equal(rejection.status, 403);
    assert.equal(rejection.code, "not_participant");
    assert.equal(statements.some((sql) => sql.includes("FROM moves")), false);
    assert.equal(statements.some((sql) => sql.includes("game_scoring_state")), false);
    assert.equal(statements.includes("BEGIN"), false);
    assert.equal(statements.includes("ROLLBACK"), false);
  });

  await t.test("timeout boundary falls through and validates history before writing", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({
          version: 2,
          main_time_seconds: 0,
          black_time_remaining_ms: 0,
          black_periods_remaining: 1,
          byo_yomi_seconds: 1,
          turn_started_at: new Date("2000-01-01T00:00:00.000Z"),
        }),
        scoring: null,
        moveRows: [{ ...emptyBoardPassRows()[0], board_hash: "tampered" }],
      },
      "move_history_mismatch",
      () => pollGameState(gameId, blackKey, 2),
    );
  });

  await t.test("expired or missing scoring falls through and fails closed", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ phase: "scoring", to_move: null, scoring_revision: 1, version: 5 }),
        scoring: scoringRow({ expires_at: new Date("2000-01-01T00:00:00.000Z") }),
        moveRows: [{ ...emptyBoardPassRows()[0], board_hash: "tampered" }],
      },
      "move_history_mismatch",
      () => pollGameState(gameId, blackKey, 5),
    );
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ phase: "scoring", to_move: null, scoring_revision: 1, version: 5 }),
        scoring: null,
      },
      "rules_configuration_mismatch",
      () => pollGameState(gameId, blackKey, 5),
    );
  });
});

test("move history trust boundary derives positions and rejects contradictory evidence", async (t) => {
  await t.test("a non-participant is rejected before the move history is queried", async () => {
    let rejection: unknown;
    const statements = await withFakeDatabase(
      {
        game: gameRow({ to_move: "white" }),
        scoring: null,
        moveRows: [{ ...emptyBoardPassRows()[0], board_hash: "tampered" }],
      },
      async () => {
        try {
          await getGameState(gameId, "guest:attacker");
        } catch (error) {
          rejection = error;
        }
      },
    );
    assert.ok(rejection instanceof GameServiceError);
    assert.equal(rejection.status, 403);
    assert.equal(rejection.code, "not_participant");
    assert.equal(statements.some((sql) => sql.includes("FROM moves")), false);
    assert.equal(statements.at(-1), "ROLLBACK");
  });

  await t.test("a non-null placement hash must match authoritative replay", async () => {
    const moves = persistedMoveRows([storedMove(1, "black", 0, 0)]);
    moves[0].board_hash = "tampered";
    await assertRejectedWithoutWrites(
      { game: gameRow({ to_move: "white" }), scoring: null, moveRows: moves },
      "move_history_mismatch",
      () => getGameState(gameId, blackKey),
    );
  });

  await t.test("a pass hash must equal its unchanged replayed position", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ to_move: "white", consecutive_passes: 1 }),
        scoring: null,
        moveRows: [{ ...emptyBoardPassRows()[0], board_hash: "tampered" }],
      },
      "move_history_mismatch",
      () => getGameState(gameId, blackKey),
    );
  });

  await t.test("a correctly hashed pass may repeat the unchanged position", async () => {
    const state = await loadState(
      gameRow({ to_move: "white", consecutive_passes: 1 }),
      null,
      [emptyBoardPassRows()[0]],
    );
    assert.equal(state.moveCount, 1);
    assert.equal(state.consecutivePasses, 1);
    assert.equal(state.turn, "white");
  });

  await t.test("an invalid move log fails closed before any write", async () => {
    const first = persistedMoveRows([storedMove(1, "black", 0, 0)])[0];
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ to_move: "black" }),
        scoring: null,
        moveRows: [
          first,
          { ...first, move_number: 2, color: "white", created_at: new Date("2099-01-01T00:02:00Z") },
        ],
      },
      "move_history_mismatch",
      () => submitMove(gameId, blackKey, { x: 1, y: 0, expectedVersion: 0 }),
    );
  });

  await t.test("a non-contiguous move log fails closed before any write", async () => {
    const moves = persistedMoveRows([
      storedMove(1, "black", 0, 0),
      storedMove(2, "white", 1, 0),
    ]);
    moves[1].move_number = 3;
    await assertRejectedWithoutWrites(
      { game: gameRow({ to_move: "black" }), scoring: null, moveRows: moves },
      "move_history_mismatch",
      () => submitMove(gameId, blackKey, { x: 2, y: 0, expectedVersion: 0 }),
    );
  });

  await t.test("current-profile history requires a stored hash", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ to_move: "white" }),
        scoring: null,
        moveRows: persistedMoveRows([storedMove(1, "black", 0, 0)], "missing"),
      },
      "move_history_mismatch",
      () => getGameState(gameId, blackKey),
    );
  });

  await t.test("nullable legacy hashes remain readable from computed history", async () => {
    const state = await loadState(
      gameRow({ rules_profile: "legacy-immediate-area", to_move: null }),
      null,
      persistedMoveRows([storedMove(1, "black", 0, 0)], "missing"),
    );
    assert.equal(state.board[0][0], "black");
    assert.equal(state.turn, "white");
  });

  await t.test("a legal move after nullable history persists and returns the derived board", async () => {
    const moveRows = persistedMoveRows([storedMove(1, "black", 0, 0)], "missing");
    let state: GameState | undefined;
    const statements = await withFakeDatabase(
      {
        game: gameRow({ rules_profile: "legacy-immediate-area", to_move: null }),
        scoring: null,
        moveRows,
        allowMoveWrite: true,
      },
      async () => {
        state = await submitMove(gameId, whiteKey, { x: 1, y: 0, expectedVersion: 0 });
      },
    );
    assert.ok(state);
    assert.equal(state.board[0][0], "black");
    assert.equal(state.board[0][1], "white");
    assert.equal(state.moveCount, 2);
    assert.equal(state.turn, "black");
    assert.equal(moveRows[1].board_hash, boardHash(state.board));
    assert.equal(statements.at(-1), "COMMIT");
  });

  await t.test("a pass remains exempt from superko and stores the unchanged derived hash", async () => {
    const moveRows = persistedMoveRows([storedMove(1, "black", 0, 0)], "missing");
    let state: GameState | undefined;
    await withFakeDatabase(
      {
        game: gameRow({ rules_profile: "legacy-immediate-area", to_move: null }),
        scoring: null,
        moveRows,
        allowMoveWrite: true,
      },
      async () => {
        state = await submitMove(gameId, whiteKey, { isPass: true, expectedVersion: 0 });
      },
    );
    assert.ok(state);
    assert.equal(state.moveCount, 2);
    assert.equal(state.consecutivePasses, 1);
    assert.equal(state.turn, "black");
    assert.equal(moveRows[1].is_pass, true);
    assert.equal(moveRows[1].board_hash, boardHash(state.board));
  });

  await t.test("nullable hashes cannot bypass Chinese positional superko", async () => {
    const moves = [
      storedMove(1, "black", 0, 1),
      storedMove(2, "white", 1, 1),
      storedMove(3, "black", 2, 1),
      storedMove(4, "white", 0, 2),
      storedMove(5, "black", 1, 0),
      storedMove(6, "white", 2, 2),
      storedMove(7, "black", 8, 8),
      storedMove(8, "white", 1, 3),
      storedMove(9, "black", 1, 2),
    ];
    let rejection: unknown;
    const statements = await withFakeDatabase(
      {
        game: gameRow({ rules_profile: "legacy-immediate-area", to_move: null }),
        scoring: null,
        moveRows: persistedMoveRows(moves, "missing"),
      },
      async () => {
        try {
          await submitMove(gameId, whiteKey, { x: 1, y: 1, expectedVersion: 0 });
        } catch (error) {
          rejection = error;
        }
      },
    );
    assert.ok(rejection instanceof GameServiceError);
    assert.equal(rejection.status, 409);
    assert.equal(rejection.code, "ko");
    assert.deepEqual(
      statements.filter((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql)),
      [],
    );
    assert.equal(statements.includes("ROLLBACK"), true);
  });

  await t.test("correct hashes cannot launder an illegal historical superko recapture", async () => {
    const moves = [
      storedMove(1, "black", 0, 1),
      storedMove(2, "white", 1, 1),
      storedMove(3, "black", 2, 1),
      storedMove(4, "white", 0, 2),
      storedMove(5, "black", 1, 0),
      storedMove(6, "white", 2, 2),
      storedMove(7, "black", 8, 8),
      storedMove(8, "white", 1, 3),
      storedMove(9, "black", 1, 2),
      storedMove(10, "white", 1, 1),
    ];
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ rules_profile: "legacy-immediate-area", to_move: null }),
        scoring: null,
        moveRows: persistedMoveRows(moves),
      },
      "move_history_mismatch",
      () => getGameState(gameId, blackKey),
    );
  });

  await t.test("scoring and a claim-dependent resume preserve the complete position history", async () => {
    const moves = [
      storedMove(1, "black", 0, 1),
      storedMove(2, "white", 1, 1),
      storedMove(3, "black", 2, 1),
      storedMove(4, "white", 0, 2),
      storedMove(5, "black", 1, 0),
      storedMove(6, "white", 2, 2),
      storedMove(7, "black", 8, 8),
      storedMove(8, "white", 1, 3),
      storedMove(9, "black", 1, 2),
      storedMove(10, "white", null, null, true),
      storedMove(11, "black", null, null, true),
    ];
    const moveRows = persistedMoveRows(moves);
    let currentGame: Record<string, unknown> = gameRow({
      phase: "scoring",
      to_move: null,
      consecutive_passes: 2,
      scoring_revision: 1,
    });
    let currentScoring: Record<string, unknown> | null = scoringRow({
      board_hash: moveRows.at(-1)!.board_hash,
      stopped_move_number: moveRows.length,
      fallback_to_move: "white",
    });
    const expectedScoringExpiresAt = currentScoring.expires_at;
    let currentDeadRows: Record<string, unknown>[] = [{ x: 8, y: 8, color: "black" }];
    const statements: string[] = [];
    const resumeEvidenceWrites: unknown[][] = [];
    const client = {
      async query(sql: string, values: unknown[] = []) {
        statements.push(sql);
        if (sql === "BEGIN" || sql.startsWith("SET LOCAL") || sql === "COMMIT" || sql === "ROLLBACK") {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("FROM games g")) return { rows: [currentGame], rowCount: 1 };
        if (sql.includes("FROM moves")) return { rows: moveRows, rowCount: moveRows.length };
        if (sql.trimStart().startsWith("SELECT") && sql.includes("FROM game_scoring_state")) {
          return { rows: currentScoring ? [currentScoring] : [], rowCount: currentScoring ? 1 : 0 };
        }
        if (sql.includes("FROM game_dead_stones")) {
          return { rows: currentDeadRows, rowCount: currentDeadRows.length };
        }
        if (sql.includes("INSERT INTO game_scoring_resume_events")) {
          resumeEvidenceWrites.push(values);
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("DELETE FROM game_scoring_state")) {
          currentScoring = null;
          currentDeadRows = [];
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SET phase = 'play', to_move = $2")) {
          assert.match(sql, /turn_started_at = \$7, updated_at = \$8/);
          assert.equal(values.length, 8);
          assert.equal(values[6], values[7]);
          currentGame = {
            ...currentGame,
            phase: "play",
            to_move: values[1],
            consecutive_passes: 0,
            scoring_revision: Number(currentGame.scoring_revision) + 1,
            last_resume_claim: values[2],
            last_resume_by: values[3],
            last_resume_x: values[4],
            last_resume_y: values[5],
            turn_started_at: values[6],
            version: Number(currentGame.version) + 1,
          };
          return { rows: [currentGame], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO moves")) {
          return {
            rows: [{
              move_number: values[1],
              color: values[2],
              x: values[3],
              y: values[4],
              is_pass: values[5],
              board_hash: values[6],
              created_at: new Date("2099-01-01T00:12:00.000Z"),
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("UPDATE games") && sql.includes("SET to_move = $2")) {
          currentGame = {
            ...currentGame,
            to_move: values[1],
            consecutive_passes: values[2],
            black_time_remaining_ms: values[3],
            white_time_remaining_ms: values[4],
            black_periods_remaining: values[5],
            white_periods_remaining: values[6],
            turn_started_at: values[7],
            version: Number(currentGame.version) + 1,
          };
          return { rows: [currentGame], rowCount: 1 };
        }
        throw new Error(`Unexpected database statement in resume-history test: ${sql}`);
      },
      release() {},
    };
    const previousPool = globalThis.goStonedDbPool;
    globalThis.goStonedDbPool = { connect: async () => client } as unknown as Pool;

    try {
      const resumed = await resumePlay(gameId, blackKey, 1, "dead", { x: 8, y: 8 });
      assert.equal(resumed.phase, "play");
      assert.equal(resumed.turn, "black");
      assert.equal(resumed.moveCount, 11);
      assert.equal(resumeEvidenceWrites.length, 1);
      assert.deepEqual(resumeEvidenceWrites[0].slice(0, 16), [
        gameId,
        1,
        moveRows.at(-1)!.board_hash,
        moveRows.length,
        "chinese",
        "chinese-2002-gostone-v1",
        "area",
        7.5,
        0,
        "white",
        expectedScoringExpiresAt,
        "dead",
        "black",
        8,
        8,
        "black",
      ]);
      assert.ok(resumeEvidenceWrites[0][16] instanceof Date);
      assert.equal(currentGame.turn_started_at, resumeEvidenceWrites[0][16]);
      const lockedGameRead = statements.findIndex((sql) => sql.includes("FOR UPDATE OF g"));
      const evidenceInsert = statements.findIndex((sql) =>
        sql.includes("INSERT INTO game_scoring_resume_events"),
      );
      const scoringDelete = statements.findIndex((sql) =>
        sql.startsWith("DELETE FROM game_scoring_state"),
      );
      assert.ok(lockedGameRead >= 0);
      assert.ok(evidenceInsert > lockedGameRead);
      assert.ok(scoringDelete > evidenceInsert);

      const passed = await submitMove(gameId, blackKey, {
        isPass: true,
        expectedVersion: Number(currentGame.version),
      });
      assert.equal(passed.turn, "white");
      assert.equal(passed.moveCount, 12);
      assert.equal(passed.consecutivePasses, 1);

      const writeCount = statements.filter((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql)).length;
      await assert.rejects(
        () => submitMove(gameId, whiteKey, {
          x: 1,
          y: 1,
          expectedVersion: Number(currentGame.version),
        }),
        (error: unknown) => error instanceof GameServiceError
          && error.status === 409
          && error.code === "ko",
      );
      assert.equal(moveRows.length, 12);
      assert.equal(
        statements.filter((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql)).length,
        writeCount,
      );
      assert.equal(statements.at(-1), "ROLLBACK");
    } finally {
      globalThis.goStonedDbPool = previousPool;
    }
  });
});

test("an expired scoring snapshot records deadline evidence before resuming play", async () => {
  const expiresAt = new Date(Date.now() - 60_000);
  const initialGame = gameRow({
    phase: "scoring",
    to_move: null,
    consecutive_passes: 2,
    scoring_revision: 1,
  });
  let currentScoring: Record<string, unknown> | null = scoringRow({
    expires_at: expiresAt,
    started_at: new Date(expiresAt.getTime() - 600_000),
    updated_at: new Date(expiresAt.getTime() - 600_000),
  });
  const statements: string[] = [];
  const evidenceWrites: unknown[][] = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      statements.push(sql);
      if (sql === "BEGIN" || sql.startsWith("SET LOCAL") || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM games g")) return { rows: [initialGame], rowCount: 1 };
      if (sql.includes("FROM moves")) return { rows: emptyBoardPassRows(), rowCount: 2 };
      if (sql.includes("FROM game_scoring_state")) {
        return { rows: currentScoring ? [currentScoring] : [], rowCount: currentScoring ? 1 : 0 };
      }
      if (sql.includes("FROM game_dead_stones")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO game_scoring_resume_events")) {
        evidenceWrites.push(values);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("DELETE FROM game_scoring_state")) {
        currentScoring = null;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("last_resume_claim = 'deadline'")) {
        assert.match(sql, /turn_started_at = \$3, updated_at = \$4/);
        assert.equal(values.length, 4);
        assert.equal(values[2], values[3]);
        return {
          rows: [{
            ...initialGame,
            phase: "play",
            to_move: values[1],
            consecutive_passes: 0,
            scoring_revision: 2,
            last_resume_claim: "deadline",
            last_resume_by: null,
            last_resume_x: null,
            last_resume_y: null,
            turn_started_at: values[2],
            version: 1,
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected database statement in deadline-evidence test: ${sql}`);
    },
    release() {},
  };
  const previousPool = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = { connect: async () => client } as unknown as Pool;

  let state: GameState;
  try {
    state = await getGameState(gameId, blackKey);
  } finally {
    globalThis.goStonedDbPool = previousPool;
  }

  assert.equal(state.phase, "play");
  assert.equal(state.lastResume?.claim, "deadline");
  assert.equal(state.lastResume?.requestedBy, null);
  assert.equal("resumeEvents" in state, false);
  assert.equal(evidenceWrites.length, 1);
  assert.deepEqual(evidenceWrites[0].slice(0, 16), [
    gameId,
    1,
    emptyBoardHash,
    2,
    "chinese",
    "chinese-2002-gostone-v1",
    "area",
    7.5,
    0,
    "black",
    expiresAt,
    "deadline",
    null,
    null,
    null,
    "black",
  ]);
  assert.ok(evidenceWrites[0][16] instanceof Date);
  assert.ok((evidenceWrites[0][16] as Date).getTime() >= expiresAt.getTime());
  const lock = statements.findIndex((sql) => sql.includes("FOR UPDATE OF g"));
  const evidenceInsert = statements.findIndex((sql) =>
    sql.includes("INSERT INTO game_scoring_resume_events"),
  );
  const scoringDelete = statements.findIndex((sql) =>
    sql.startsWith("DELETE FROM game_scoring_state"),
  );
  const gameUpdate = statements.findIndex((sql) => sql.includes("last_resume_claim = 'deadline'"));
  assert.ok(lock >= 0);
  assert.ok(evidenceInsert > lock);
  assert.ok(scoringDelete > evidenceInsert);
  assert.ok(gameUpdate > scoringDelete);
  assert.equal(statements.at(-1), "COMMIT");
});

test("resume transactions roll back evidence and mutable state together", async (t) => {
  for (const failure of ["evidence insert", "game update"] as const) {
    await t.test(failure, async () => {
      const expiresAt = new Date(Date.now() - 60_000);
      const initialGame = gameRow({
        phase: "scoring",
        to_move: null,
        consecutive_passes: 2,
        scoring_revision: 1,
      });
      const currentScoring = scoringRow({
        expires_at: expiresAt,
        started_at: new Date(expiresAt.getTime() - 600_000),
        updated_at: new Date(expiresAt.getTime() - 600_000),
      });
      const statements: string[] = [];
      const client = {
        async query(sql: string) {
          statements.push(sql);
          if (sql === "BEGIN" || sql.startsWith("SET LOCAL") || sql === "ROLLBACK") {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("FROM games g")) return { rows: [initialGame], rowCount: 1 };
          if (sql.includes("FROM moves")) return { rows: emptyBoardPassRows(), rowCount: 2 };
          if (sql.includes("FROM game_scoring_state")) {
            return { rows: [currentScoring], rowCount: 1 };
          }
          if (sql.includes("FROM game_dead_stones")) return { rows: [], rowCount: 0 };
          if (sql.includes("INSERT INTO game_scoring_resume_events")) {
            if (failure === "evidence insert") throw new Error("evidence write failed");
            return { rows: [], rowCount: 1 };
          }
          if (sql.startsWith("DELETE FROM game_scoring_state")) {
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes("last_resume_claim = 'deadline'")) {
            throw new Error("game lifecycle write failed");
          }
          throw new Error(`Unexpected database statement in evidence-rollback test: ${sql}`);
        },
        release() {},
      };
      const previousPool = globalThis.goStonedDbPool;
      globalThis.goStonedDbPool = { connect: async () => client } as unknown as Pool;

      try {
        await assert.rejects(
          () => getGameState(gameId, blackKey),
          failure === "evidence insert" ? /evidence write failed/ : /game lifecycle write failed/,
        );
      } finally {
        globalThis.goStonedDbPool = previousPool;
      }

      assert.equal(
        statements.some((sql) => sql.startsWith("DELETE FROM game_scoring_state")),
        failure === "game update",
      );
      assert.equal(
        statements.some((sql) => sql.includes("last_resume_claim = 'deadline'")),
        failure === "game update",
      );
      assert.equal(statements.includes("COMMIT"), false);
      assert.equal(statements.at(-1), "ROLLBACK");
    });
  }
});

test("database rules boundary rejects malformed state before any gameplay or rating write", async (t) => {
  await t.test("unknown game profile blocks a move", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ rules_profile: "chinese-2002-gostone-v2" }),
        scoring: null,
      },
      "rules_configuration_unsupported",
      () => submitMove(gameId, blackKey, { x: 0, y: 0, expectedVersion: 0 }),
    );
  });

  await t.test("unsupported current-profile komi blocks a move", async () => {
    await assertRejectedWithoutWrites(
      { game: gameRow({ komi: "0.5" }), scoring: null },
      "rules_configuration_unsupported",
      () => submitMove(gameId, blackKey, { x: 0, y: 0, expectedVersion: 0 }),
    );
  });

  await t.test("a matching but orphaned scoring snapshot blocks play", async () => {
    await assertRejectedWithoutWrites(
      { game: gameRow(), scoring: scoringRow() },
      "rules_configuration_mismatch",
      () => submitMove(gameId, blackKey, { x: 0, y: 0, expectedVersion: 0 }),
    );
  });

  await t.test("a mismatched scoring tuple blocks confirmation", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ phase: "scoring", scoring_revision: 1 }),
        scoring: scoringRow({
          rules_profile: "legacy-immediate-area",
          komi: "6.5",
        }),
      },
      "rules_configuration_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });

  await t.test("a score result stored in the play phase is rejected", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({
          status: "finished",
          phase: "play",
          to_move: null,
          scoring_revision: 1,
          result: "W+7.5",
          finish_reason: "score",
          finished_at: new Date("2026-01-01T00:05:00.000Z"),
        }),
        scoring: scoringRow(),
      },
      "rules_configuration_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });

  await t.test("a missing agreement snapshot blocks confirmation", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ phase: "scoring", scoring_revision: 1 }),
        scoring: null,
      },
      "rules_configuration_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });
});

test("game outcome boundary rejects contradictory active and terminal tuples", async (t) => {
  for (const [name, override] of [
    ["result", { result: "B+R" }],
    ["winner", { winner_key: blackKey }],
    ["finish timestamp", { finished_at: finalizedAt }],
    ["missing persisted turn", { to_move: null }],
  ] as const) {
    await t.test(`active play with ${name}`, async () => {
      await assertRejectedWithoutWrites(
        { game: gameRow(override), scoring: null },
        "game_outcome_mismatch",
        () => getGameState(gameId, blackKey),
      );
    });
  }

  for (const finishReason of ["resignation", "timeout"] as const) {
    const suffix = finishReason === "resignation" ? "R" : "T";
    const otherSuffix = finishReason === "resignation" ? "T" : "R";
    const canonical = gameRow({
      status: "finished",
      phase: "play",
      to_move: null,
      result: `B+${suffix}`,
      winner_key: blackKey,
      finish_reason: finishReason,
      finished_at: finalizedAt,
      ...(finishReason === "timeout"
        ? { white_time_remaining_ms: 0, white_periods_remaining: 0 }
        : {}),
    });
    for (const [name, override] of [
      ["missing result", { result: null }],
      ["missing winner", { winner_key: null }],
      ["missing finish timestamp", { finished_at: null }],
      ["persisted turn", { to_move: "black" }],
      ["wrong result suffix", { result: `B+${otherSuffix}` }],
      ["winner-color mismatch", { winner_key: whiteKey }],
      ...(finishReason === "timeout"
        ? [
            ["loser with remaining time", { white_time_remaining_ms: 1 }],
            ["loser with remaining periods", { white_periods_remaining: 1 }],
          ] as const
        : []),
    ] as const) {
      await t.test(`${finishReason} with ${name}`, async () => {
        await assertRejectedWithoutWrites(
          { game: { ...canonical, ...override }, scoring: null },
          "game_outcome_mismatch",
          () => getGameState(gameId, blackKey),
        );
      });
    }
  }

  const whiteTimeout = gameRow({
    status: "finished",
    phase: "play",
    to_move: null,
    result: "W+T",
    winner_key: whiteKey,
    finish_reason: "timeout",
    finished_at: finalizedAt,
    black_time_remaining_ms: 0,
    black_periods_remaining: 0,
  });
  for (const [name, override] of [
    ["Black has remaining time", { black_time_remaining_ms: 1 }],
    ["Black has remaining periods", { black_periods_remaining: 1 }],
  ] as const) {
    await t.test(`White timeout win while ${name}`, async () => {
      await assertRejectedWithoutWrites(
        { game: { ...whiteTimeout, ...override }, scoring: null },
        "game_outcome_mismatch",
        () => getGameState(gameId, blackKey),
      );
    });
  }

  const legacy = gameRow({
    status: "finished",
    phase: "play",
    to_move: null,
    rules_profile: "legacy-immediate-area",
    komi: "7.5",
    result: "W+7.5",
    winner_key: whiteKey,
    finish_reason: "legacy_score",
    finished_at: finalizedAt,
  });
  for (const [name, override, moveRows] of [
    ["missing result", { result: null }, emptyBoardPassRows()],
    ["missing winner", { winner_key: null }, emptyBoardPassRows()],
    ["missing finish timestamp", { finished_at: null }, emptyBoardPassRows()],
    ["persisted turn", { to_move: "white" }, emptyBoardPassRows()],
    ["resignation suffix", { result: "W+R" }, emptyBoardPassRows()],
    ["incorrect score", { result: "W+1.5" }, emptyBoardPassRows()],
    ["winner-color mismatch", { winner_key: blackKey }, emptyBoardPassRows()],
    ["fewer than two final passes", {}, [emptyBoardPassRows()[0]]],
  ] as const) {
    await t.test(`legacy score with ${name}`, async () => {
      await assertRejectedWithoutWrites(
        { game: { ...legacy, ...override }, scoring: null, moveRows: [...moveRows] },
        "game_outcome_mismatch",
        () => getGameState(gameId, blackKey),
      );
    });
  }

  for (const [name, moveRows] of [
    ["two black passes", emptyBoardPassRows().map((row) => ({ ...row, color: "black" }))],
    ["white moving first", emptyBoardPassRows().map((row, index) => ({
      ...row,
      color: index === 0 ? "white" : "black",
    }))],
  ] as const) {
    await t.test(`legacy score with ${name}`, async () => {
      await assertRejectedWithoutWrites(
        { game: legacy, scoring: null, moveRows: [...moveRows] },
        "move_history_mismatch",
        () => getGameState(gameId, blackKey),
      );
    });
  }
});

test("database rules boundary preserves every supported canonical and rollout lifecycle", async (t) => {
  await t.test("active current play", async () => {
    const state = await loadState(gameRow(), null);
    assert.equal(state.status, "active");
    assert.equal(state.phase, "play");
    assert.equal(state.rulesProfile, "chinese-2002-gostone-v1");
    assert.equal(state.scoring, null);
  });

  await t.test("active agreement scoring", async () => {
    const state = await loadState(
      gameRow({ phase: "scoring", to_move: null, scoring_revision: 1 }),
      scoringRow(),
    );
    assert.equal(state.status, "active");
    assert.equal(state.phase, "scoring");
    assert.equal(state.scoring?.revision, 1);
  });

  await t.test("finished agreement score", async () => {
    const state = await loadState(
      finishedScoredGame(),
      finalizedScoringRow(),
    );
    assert.equal(state.finishReason, "score");
    assert.equal(state.scoring?.preview.result, "W+7.5");
    assert.equal(
      JSON.stringify(state.scoring?.preview),
      "{\"black\":40.5,\"white\":48,\"blackStones\":0,\"whiteStones\":0,\"blackTerritory\":0,\"whiteTerritory\":0,\"neutralPoints\":81,\"winner\":\"white\",\"margin\":7.5,\"result\":\"W+7.5\"}",
    );
  });

  for (const finishReason of ["resignation", "timeout"] as const) {
    await t.test(`finished current ${finishReason}`, async () => {
      const suffix = finishReason === "resignation" ? "R" : "T";
      const state = await loadState(gameRow({
        status: "finished",
        phase: "play",
        to_move: null,
        winner_key: blackKey,
        result: `B+${suffix}`,
        finish_reason: finishReason,
        finished_at: new Date("2099-01-01T00:05:00.000Z"),
        ...(finishReason === "timeout"
          ? { white_time_remaining_ms: 0, white_periods_remaining: 0 }
          : {}),
      }), null);
      assert.equal(state.finishReason, finishReason);
      assert.equal(state.scoring, null);
    });
  }

  await t.test("finished current timeout won by White", async () => {
    const state = await loadState(gameRow({
      status: "finished",
      phase: "play",
      to_move: null,
      winner_key: whiteKey,
      result: "W+T",
      finish_reason: "timeout",
      finished_at: new Date("2099-01-01T00:05:00.000Z"),
      black_time_remaining_ms: 0,
      black_periods_remaining: 0,
    }), null);
    assert.equal(state.finishReason, "timeout");
    assert.equal(state.result, "W+T");
  });

  for (const komi of [6.5, 7.5]) {
    await t.test(`finished legacy ${komi} komi score`, async () => {
      const state = await loadState(gameRow({
        status: "finished",
        phase: "play",
        to_move: null,
        rules_profile: "legacy-immediate-area",
        komi: String(komi),
        winner_key: whiteKey,
        result: `W+${komi}`,
        finish_reason: "legacy_score",
        finished_at: new Date("2099-01-01T00:05:00.000Z"),
      }), null, emptyBoardPassRows());
      assert.equal(state.rulesProfile, "legacy-immediate-area");
      assert.equal(state.komi, komi);
      assert.equal(state.finishReason, "legacy_score");
    });
  }

  await t.test("historical scoring-phase resignation is read canonically", async () => {
    const historicalGame = gameRow({
      status: "finished",
      phase: "scoring",
      to_move: null,
      scoring_revision: 1,
      winner_key: blackKey,
      result: "B+R",
      finish_reason: "resignation",
      finished_at: new Date("2099-01-01T00:05:00.000Z"),
    });
    const state = await loadState(historicalGame, scoringRow());
    assert.equal(state.status, "finished");
    assert.equal(state.phase, "play");
    assert.equal(state.finishReason, "resignation");
    assert.equal(state.scoring, null);

    let rejection: unknown;
    const statements = await withFakeDatabase(
      { game: historicalGame, scoring: scoringRow() },
      async () => {
        try {
          await confirmScore(gameId, blackKey, 1);
        } catch (error) {
          rejection = error;
        }
      },
    );
    assert.ok(rejection instanceof GameServiceError);
    assert.equal(rejection.status, 409);
    assert.equal(rejection.code, "game_finished");
    assert.deepEqual(
      statements.filter((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql)),
      [],
    );
  });

  await t.test("legacy rollout finish derives the missing historical reason", async () => {
    const state = await loadState(gameRow({
      status: "finished",
      phase: "play",
      to_move: "white",
      rules_profile: "legacy-immediate-area",
      komi: "6.5",
      winner_key: whiteKey,
      result: "W+6.5",
      finish_reason: null,
      finished_at: new Date("2099-01-01T00:05:00.000Z"),
    }), null, emptyBoardPassRows());
    assert.equal(state.status, "finished");
    assert.equal(state.turn, null);
    assert.equal(state.finishReason, "legacy_score");
  });
});

test("finalized Chinese score snapshots fail closed before any write", async (t) => {
  const cases = [
    ["black total", finishedScoredGame(), finalizedScoringRow({ black_total: "41.5" })],
    ["breakdown", finishedScoredGame(), finalizedScoringRow({ black_stones: 1 })],
    ["score result", finishedScoredGame(), finalizedScoringRow({ result: "B+7.5" })],
    ["non-finite total", finishedScoredGame(), finalizedScoringRow({ white_total: "NaN" })],
    ["partial final fields", finishedScoredGame(), finalizedScoringRow({ black_stones: null })],
    ["game result", finishedScoredGame({ result: "W+6.5" }), finalizedScoringRow()],
    ["winner key", finishedScoredGame({ winner_key: blackKey }), finalizedScoringRow()],
    ["dead-stone count", finishedScoredGame(), finalizedScoringRow({ black_dead_stones: 1 })],
    ["stopped board hash", finishedScoredGame(), finalizedScoringRow({ board_hash: "corrupt" })],
    ["scored board hash", finishedScoredGame(), finalizedScoringRow({ scored_board_hash: "corrupt" })],
    [
      "self-consistent score unrelated to the board",
      finishedScoredGame({ result: "B+73.5", winner_key: blackKey }),
      finalizedScoringRow({
        black_stones: 0,
        white_stones: 0,
        black_territory: 81,
        white_territory: 0,
        neutral_points: 0,
        black_total: "81.0",
        white_total: "7.5",
        result: "B+73.5",
      }),
    ],
  ] as const;
  for (const [name, game, scoring] of cases) {
    await t.test(name, async () => {
      await assertRejectedWithoutWrites(
        { game, scoring },
        "scoring_snapshot_mismatch",
        () => confirmScore(gameId, blackKey, 1),
      );
    });
  }

  await t.test("dead-stone color does not match the stopped board", async () => {
    await assertRejectedWithoutWrites(
      {
        game: finishedScoredGame(),
        scoring: finalizedScoringRow({ black_dead_stones: 1 }),
        deadRows: [{ x: 0, y: 0, color: "black" }],
      },
      "scoring_snapshot_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });

  await t.test("finished score has no finalized snapshot", async () => {
    await assertRejectedWithoutWrites(
      { game: finishedScoredGame(), scoring: scoringRow() },
      "scoring_snapshot_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });

  await t.test("active scoring has terminal snapshot fields", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ phase: "scoring", to_move: null, scoring_revision: 1 }),
        scoring: finalizedScoringRow(),
      },
      "scoring_snapshot_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });

  await t.test("active scoring cannot persist both confirmations without finalizing", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ phase: "scoring", to_move: null, scoring_revision: 1 }),
        scoring: scoringRow({
          black_confirmed_revision: 1,
          white_confirmed_revision: 1,
          black_confirmed_at: finalizedAt,
          white_confirmed_at: finalizedAt,
        }),
      },
      "scoring_snapshot_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });

  await t.test("game and snapshot revisions differ", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ phase: "scoring", to_move: null, scoring_revision: 2 }),
        scoring: scoringRow(),
      },
      "scoring_snapshot_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });

  await t.test("persisted dead stones contain only part of a connected group", async () => {
    const moveRows = persistedMoveRows([
      storedMove(1, "black", 0, 0),
      storedMove(2, "white", 8, 8),
      storedMove(3, "black", 1, 0),
      storedMove(4, "white", null, null, true),
      storedMove(5, "black", null, null, true),
    ]);
    const board = createEmptyBoard(9);
    board[0][0] = "black";
    board[0][1] = "black";
    board[8][8] = "white";
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ phase: "scoring", to_move: null, scoring_revision: 1 }),
        scoring: scoringRow({
          board_hash: boardHash(board),
          stopped_move_number: moveRows.length,
        }),
        deadRows: [{ x: 0, y: 0, color: "black" }],
        moveRows,
      },
      "scoring_snapshot_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });

  await t.test("expired corrupt state cannot be deleted before validation", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ phase: "scoring", to_move: null, scoring_revision: 1 }),
        scoring: scoringRow({ board_hash: "corrupt", expires_at: new Date(0) }),
      },
      "scoring_snapshot_mismatch",
      () => getGameState(gameId, blackKey),
    );
  });

  await t.test("resignation cannot launder corrupt scoring state", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ phase: "scoring", to_move: null, scoring_revision: 1 }),
        scoring: scoringRow({ board_hash: "corrupt" }),
      },
      "scoring_snapshot_mismatch",
      () => resignGame(gameId, blackKey),
    );
  });

  const historicalResignation = gameRow({
    status: "finished",
    phase: "scoring",
    to_move: null,
    scoring_revision: 1,
    winner_key: blackKey,
    result: "B+R",
    finish_reason: "resignation",
    finished_at: finalizedAt,
  });
  await t.test("historical resignation cannot discard a corrupt stopped board", async () => {
    await assertRejectedWithoutWrites(
      {
        game: historicalResignation,
        scoring: scoringRow({ board_hash: "corrupt" }),
      },
      "scoring_snapshot_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });

  await t.test("historical resignation cannot discard invalid dead-stone rows", async () => {
    await assertRejectedWithoutWrites(
      {
        game: historicalResignation,
        scoring: scoringRow(),
        deadRows: [{ x: 0, y: 0, color: "black" }],
      },
      "scoring_snapshot_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });

  await t.test("historical resignation cannot discard mismatched confirmation metadata", async () => {
    await assertRejectedWithoutWrites(
      {
        game: historicalResignation,
        scoring: scoringRow({ black_confirmed_revision: 1, black_confirmed_at: null }),
      },
      "scoring_snapshot_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });

  await t.test("historical resignation cannot discard two unfinalized confirmations", async () => {
    await assertRejectedWithoutWrites(
      {
        game: historicalResignation,
        scoring: scoringRow({
          black_confirmed_revision: 1,
          white_confirmed_revision: 1,
          black_confirmed_at: finalizedAt,
          white_confirmed_at: finalizedAt,
        }),
      },
      "rules_configuration_mismatch",
      () => confirmScore(gameId, blackKey, 1),
    );
  });
});

test("historical lifecycle compatibility rejects every unreachable near miss", async (t) => {
  const historicalResignation = gameRow({
    status: "finished",
    phase: "scoring",
    to_move: null,
    scoring_revision: 1,
    winner_key: blackKey,
    result: "B+R",
    finish_reason: "resignation",
    finished_at: new Date("2099-01-01T00:05:00.000Z"),
  });
  const currentNearMisses = [
    ["malformed result", { ...historicalResignation, result: "corrupt+R" }, scoringRow()],
    ["missing winner", { ...historicalResignation, winner_key: null }, scoringRow()],
    ["wrong winner", { ...historicalResignation, winner_key: "guest:white" }, scoringRow()],
    ["missing finish timestamp", { ...historicalResignation, finished_at: null }, scoringRow()],
    ["persisted turn", { ...historicalResignation, to_move: "black" }, scoringRow()],
    ["revision mismatch", historicalResignation, scoringRow({ revision: 2 })],
    [
      "finalized snapshot",
      historicalResignation,
      scoringRow({
        finalized_at: new Date("2099-01-01T00:05:00.000Z"),
        result: "B+1.5",
        scored_board_hash: "final",
      }),
    ],
  ] as const;
  for (const [name, game, scoring] of currentNearMisses) {
    await t.test(`agreement resignation with ${name}`, async () => {
      await assertRejectedWithoutWrites(
        { game, scoring },
        "rules_configuration_mismatch",
        () => confirmScore(gameId, blackKey, 1),
      );
    });
  }

  const legacyRollout = gameRow({
    status: "finished",
    phase: "play",
    to_move: "white",
    rules_profile: "legacy-immediate-area",
    komi: "6.5",
    winner_key: blackKey,
    result: "B+2.5",
    finish_reason: null,
    finished_at: new Date("2099-01-01T00:05:00.000Z"),
  });
  for (const [name, game] of [
    ["malformed result", { ...legacyRollout, result: "invalid" }],
    ["missing winner", { ...legacyRollout, winner_key: null }],
    ["wrong winner", { ...legacyRollout, winner_key: "guest:white" }],
    ["missing finish timestamp", { ...legacyRollout, finished_at: null }],
  ] as const) {
    await t.test(`legacy rollout finish with ${name}`, async () => {
      await assertRejectedWithoutWrites(
        { game, scoring: null },
        "rules_configuration_mismatch",
        () => submitMove(gameId, blackKey, { x: 0, y: 0, expectedVersion: 0 }),
      );
    });
  }
});

test("second score confirmation rates two database-verified registered players", async () => {
  const initialGame = gameRow({
    black_player_key: blackUserKey,
    white_player_key: whiteUserKey,
    rated: true,
    phase: "scoring",
    to_move: null,
    scoring_revision: 1,
  });
  const blackConfirmedAt = new Date("2099-01-01T00:03:00.000Z");
  const stoppedBoard = createEmptyBoard(9);
  stoppedBoard[0][1] = "black";
  stoppedBoard[1][0] = "black";
  stoppedBoard[8][8] = "white";
  const scoredBoard = stoppedBoard.map((row) => [...row]);
  scoredBoard[8][8] = null;
  const moveRows = persistedMoveRows([
    storedMove(1, "black", 1, 0),
    storedMove(2, "white", 8, 8),
    storedMove(3, "black", 0, 1),
    storedMove(4, "white", null, null, true),
    storedMove(5, "black", null, null, true),
  ]);
  const deadRows = [{ x: 8, y: 8, color: "white" }];
  const initialScoring = scoringRow({
    board_hash: boardHash(stoppedBoard),
    stopped_move_number: moveRows.length,
    black_confirmed_revision: 1,
    black_confirmed_at: blackConfirmedAt,
  });
  let scoringWrite: unknown[] | undefined;
  let gameFinishWrite: unknown[] | undefined;
  const ratingLedgerWrites: unknown[][] = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql === "BEGIN" || sql.startsWith("SET LOCAL") || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM games g")) return { rows: [initialGame], rowCount: 1 };
      if (sql.includes("FROM moves")) return { rows: moveRows, rowCount: moveRows.length };
      if (sql.includes("FROM game_scoring_state")) return { rows: [initialScoring], rowCount: 1 };
      if (sql.includes("FROM game_dead_stones")) return { rows: deadRows, rowCount: deadRows.length };
      if (sql.includes("UPDATE game_scoring_state") && sql.includes("white_confirmed_revision")) {
        return {
          rows: [{
            ...initialScoring,
            white_confirmed_revision: 1,
            white_confirmed_at: values[2],
            updated_at: values[2],
          }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("UPDATE games SET updated_at")) {
        return { rows: [{ ...initialGame, version: 1 }], rowCount: 1 };
      }
      if (sql.includes("UPDATE game_scoring_state") && sql.includes("scored_board_hash")) {
        scoringWrite = values;
        return {
          rows: [finalizedScoringRow({
            board_hash: boardHash(stoppedBoard),
            stopped_move_number: moveRows.length,
            black_confirmed_revision: 1,
            white_confirmed_revision: 1,
            black_confirmed_at: blackConfirmedAt,
            white_confirmed_at: values[12],
            scored_board_hash: values[1],
            black_stones: values[2],
            white_stones: values[3],
            black_territory: values[4],
            white_territory: values[5],
            neutral_points: values[6],
            black_dead_stones: values[7],
            white_dead_stones: values[8],
            black_total: values[9],
            white_total: values[10],
            result: values[11],
            finalized_at: values[12],
          })],
          rowCount: 1,
        };
      }
      if (sql.includes("UPDATE games") && sql.includes("finish_reason = 'score'")) {
        gameFinishWrite = values;
        return {
          rows: [finishedScoredGame({
            black_player_key: blackUserKey,
            white_player_key: whiteUserKey,
            rated: true,
            result: values[1],
            winner_key: values[2],
            finished_at: values[3],
            version: 2,
          })],
          rowCount: 1,
        };
      }
      if (sql.includes("AS player_key") && sql.includes("FROM users")) {
        assert.deepEqual(values, [blackUserKey, whiteUserKey]);
        return {
          rows: [{ player_key: blackUserKey }, { player_key: whiteUserKey }],
          rowCount: 2,
        };
      }
      if (sql.includes("FROM player_rating_history") && sql.includes("FOR UPDATE")) {
        assert.deepEqual(values, [gameId]);
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT rating") && sql.includes("FROM player_stats")) {
        return { rows: [{ rating: 1_200 }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO player_rating_history")) {
        ratingLedgerWrites.push(values);
        return { rows: [{ id: `history-${ratingLedgerWrites.length}` }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO player_stats") || sql.includes("UPDATE player_stats")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected database statement in score finalization test: ${sql}`);
    },
    release() {},
  };
  const previousPool = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = {
    connect: async () => client,
  } as unknown as Pool;

  let state: GameState;
  try {
    state = await confirmScore(gameId, whiteUserKey, 1);
  } finally {
    globalThis.goStonedDbPool = previousPool;
  }

  assert.ok(scoringWrite);
  const finalizedAt = scoringWrite[12];
  assert.ok(finalizedAt instanceof Date);
  assert.deepEqual(scoringWrite, [
    gameId,
    boardHash(scoredBoard),
    2,
    0,
    79,
    0,
    0,
    0,
    1,
    81,
    7.5,
    "B+73.5",
    finalizedAt,
  ]);
  assert.deepEqual(gameFinishWrite, [gameId, "B+73.5", blackUserKey, finalizedAt]);
  assert.deepEqual(
    ratingLedgerWrites.map((values) => [values[0], values[5], values[6]]),
    [
      [blackUserKey, 16, "win"],
      [whiteUserKey, -16, "loss"],
    ],
  );
  assert.equal(state.winnerKey, blackUserKey);
  assert.equal(state.rated, true);
  assert.equal(
    JSON.stringify(state.scoring?.preview),
    "{\"black\":81,\"white\":7.5,\"blackStones\":2,\"whiteStones\":0,\"blackTerritory\":79,\"whiteTerritory\":0,\"neutralPoints\":0,\"winner\":\"black\",\"margin\":73.5,\"result\":\"B+73.5\"}",
  );
});

test("rating finalization rolls back pre-existing and racing ledger conflicts", async (t) => {
  for (const mode of ["pre-existing", "insert-race"] as const) {
    await t.test(mode, async () => {
      const statements: string[] = [];
      const activeGame = gameRow({
        black_player_key: blackUserKey,
        white_player_key: whiteUserKey,
        rated: true,
      });
      const finishedGame = gameRow({
        ...activeGame,
        status: "finished",
        phase: "play",
        to_move: null,
        result: "W+R",
        winner_key: whiteUserKey,
        finish_reason: "resignation",
        finished_at: finalizedAt,
        version: 1,
      });
      const client = {
        async query(sql: string) {
          statements.push(sql);
          if (sql === "BEGIN" || sql.startsWith("SET LOCAL") || sql === "COMMIT" || sql === "ROLLBACK") {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("FROM games g")) return { rows: [activeGame], rowCount: 1 };
          if (sql.includes("FROM moves")) return { rows: [], rowCount: 0 };
          if (sql.includes("FROM game_scoring_state")) return { rows: [], rowCount: 0 };
          if (sql.includes("UPDATE games") && sql.includes("finish_reason = 'resignation'")) {
            return { rows: [finishedGame], rowCount: 1 };
          }
          if (sql.includes("AS player_key") && sql.includes("FROM users")) {
            return {
              rows: [{ player_key: blackUserKey }, { player_key: whiteUserKey }],
              rowCount: 2,
            };
          }
          if (sql.includes("FROM player_rating_history") && sql.includes("FOR UPDATE")) {
            return mode === "pre-existing"
              ? { rows: [{ player_key: blackUserKey }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          if (sql.includes("INSERT INTO player_stats")) return { rows: [], rowCount: 1 };
          if (sql.includes("SELECT rating") && sql.includes("FROM player_stats")) {
            return { rows: [{ rating: 1_200 }], rowCount: 1 };
          }
          if (sql.includes("INSERT INTO player_rating_history")) {
            return { rows: [], rowCount: 0 };
          }
          throw new Error(`Unexpected database statement in rating-conflict test: ${sql}`);
        },
        release() {},
      };
      const previousPool = globalThis.goStonedDbPool;
      globalThis.goStonedDbPool = { connect: async () => client } as unknown as Pool;

      let rejection: unknown;
      try {
        await resignGame(gameId, blackUserKey);
      } catch (error) {
        rejection = error;
      } finally {
        globalThis.goStonedDbPool = previousPool;
      }

      assert.ok(rejection instanceof GameServiceError);
      assert.equal(rejection.code, "rating_history_conflict");
      assert.equal(statements.includes("ROLLBACK"), true);
      assert.equal(statements.includes("COMMIT"), false);
      assert.equal(statements.some((sql) => sql.includes("UPDATE player_stats")), false);
      assert.equal(
        statements.filter((sql) => sql.includes("INSERT INTO player_rating_history")).length,
        mode === "insert-race" ? 1 : 0,
      );
    });
  }
});

test("a controlled guest can resign to an account without creating rating writes", async () => {
  const statements: string[] = [];
  const eligibilityChecks: unknown[][] = [];
  const initialGame = gameRow({
    black_player_key: blackUserKey,
    phase: "scoring",
    to_move: null,
    scoring_revision: 1,
  });
  const finishedGame = gameRow({
    black_player_key: blackUserKey,
    status: "finished",
    phase: "play",
    to_move: null,
    scoring_revision: 1,
    winner_key: blackUserKey,
    result: "B+R",
    finish_reason: "resignation",
    finished_at: new Date("2099-01-01T00:05:00.000Z"),
    version: 1,
  });
  const client = {
    async query(sql: string, values: unknown[] = []) {
      statements.push(sql);
      if (sql === "BEGIN" || sql.startsWith("SET LOCAL") || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM games g")) return { rows: [initialGame], rowCount: 1 };
      if (sql.includes("FROM moves")) {
        return { rows: emptyBoardPassRows(), rowCount: 2 };
      }
      if (sql.includes("FROM game_scoring_state")) return { rows: [scoringRow()], rowCount: 1 };
      if (sql.includes("FROM game_dead_stones")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("DELETE FROM game_scoring_state")) return { rows: [], rowCount: 1 };
      if (sql.includes("UPDATE games") && sql.includes("finish_reason = 'resignation'")) {
        return { rows: [finishedGame], rowCount: 1 };
      }
      if (sql.includes("FROM player_rating_history") && sql.includes("FOR UPDATE")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("AS player_key") && sql.includes("FROM users")) {
        eligibilityChecks.push(values);
        return { rows: [{ player_key: blackUserKey }], rowCount: 1 };
      }
      if (sql.includes("SELECT rating") && sql.includes("FROM player_stats")) {
        return { rows: [{ rating: 1_200 }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO player_rating_history")) {
        return { rows: [{ id: "history" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO player_stats") || sql.includes("UPDATE player_stats")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected database statement in resignation test: ${sql}`);
    },
    release() {},
  };
  const previousPool = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = {
    connect: async () => client,
  } as unknown as Pool;

  let state: GameState;
  try {
    state = await resignGame(gameId, "guest:white");
  } finally {
    globalThis.goStonedDbPool = previousPool;
  }

  assert.equal(state.status, "finished");
  assert.equal(state.phase, "play");
  assert.equal(state.finishReason, "resignation");
  assert.equal(state.scoring, null);
  assert.equal(state.rated, false);
  const scoringDelete = statements.findIndex((sql) => sql.startsWith("DELETE FROM game_scoring_state"));
  const gameFinish = statements.findIndex((sql) =>
    sql.includes("UPDATE games") && sql.includes("finish_reason = 'resignation'"),
  );
  const ratingWrite = statements.findIndex((sql) => sql.includes("INSERT INTO player_rating_history"));
  const statsWrite = statements.findIndex((sql) => sql.includes("INSERT INTO player_stats"));
  assert.ok(scoringDelete >= 0);
  assert.ok(gameFinish > scoringDelete);
  assert.deepEqual(eligibilityChecks, [[blackUserKey, whiteKey]]);
  assert.equal(ratingWrite, -1);
  assert.equal(statsWrite, -1);
  assert.equal(statements.at(-1), "COMMIT");
});
