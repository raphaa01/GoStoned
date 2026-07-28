import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  confirmScore,
  GameServiceError,
  getGameState,
  resignGame,
  submitMove,
} from "./gameService";
import { boardHash, createEmptyBoard } from "./goEngine";
import type { GameState } from "./types";

const gameId = "11111111-1111-4111-8111-111111111111";
const blackKey = "guest:black";
const whiteKey = "guest:white";
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
  },
  action: () => Promise<unknown>,
): Promise<string[]> {
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
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
      throw new Error(`Unexpected database statement in fail-closed test: ${sql}`);
    },
    release() {},
  };
  const previousPool = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = {
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
  },
  expectedCode: string,
  action: () => Promise<unknown>,
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
  assert.equal(rejection.status, 500);
  assert.equal(rejection.code, expectedCode);
  assert.deepEqual(
    statements.filter((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql)),
    [],
  );
  assert.equal(statements.includes("ROLLBACK"), true);
  assert.equal(statements.includes("COMMIT"), false);
}

async function loadState(
  game: Record<string, unknown>,
  scoring: Record<string, unknown> | null,
): Promise<GameState> {
  let state: GameState | undefined;
  const statements = await withFakeDatabase({ game, scoring }, async () => {
    state = await getGameState(gameId, blackKey);
  });
  assert.ok(state);
  assert.equal(statements.includes("COMMIT"), true);
  assert.equal(statements.includes("ROLLBACK"), false);
  return state;
}

test("database rules boundary rejects malformed state before any gameplay or rating write", async (t) => {
  await t.test("unknown game profile blocks a move", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({ rules_profile: "chinese-2002-gostone-v2" }),
        scoring: null,
      },
      "rules_configuration_unsupported",
      () => submitMove(gameId, blackKey, { x: 0, y: 0 }),
    );
  });

  await t.test("unsupported current-profile komi blocks a move", async () => {
    await assertRejectedWithoutWrites(
      { game: gameRow({ komi: "0.5" }), scoring: null },
      "rules_configuration_unsupported",
      () => submitMove(gameId, blackKey, { x: 0, y: 0 }),
    );
  });

  await t.test("a matching but orphaned scoring snapshot blocks play", async () => {
    await assertRejectedWithoutWrites(
      { game: gameRow(), scoring: scoringRow() },
      "rules_configuration_mismatch",
      () => submitMove(gameId, blackKey, { x: 0, y: 0 }),
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
        result: `B+${suffix}`,
        finish_reason: finishReason,
        finished_at: new Date("2099-01-01T00:05:00.000Z"),
      }), null);
      assert.equal(state.finishReason, finishReason);
      assert.equal(state.scoring, null);
    });
  }

  for (const komi of [6.5, 7.5]) {
    await t.test(`finished legacy ${komi} komi score`, async () => {
      const state = await loadState(gameRow({
        status: "finished",
        phase: "play",
        to_move: null,
        rules_profile: "legacy-immediate-area",
        komi: String(komi),
        result: `W+${komi}`,
        finish_reason: "legacy_score",
        finished_at: new Date("2099-01-01T00:05:00.000Z"),
      }), null);
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
      winner_key: blackKey,
      result: "B+2.5",
      finish_reason: null,
      finished_at: new Date("2099-01-01T00:05:00.000Z"),
    }), null);
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
    const moveRows = [
      [1, "black", 0, 0, false],
      [2, "white", 8, 8, false],
      [3, "black", 1, 0, false],
      [4, "white", null, null, true],
      [5, "black", null, null, true],
    ].map(([move_number, color, x, y, is_pass]) => ({
      move_number,
      color,
      x,
      y,
      is_pass,
      board_hash: null,
      created_at: new Date(`2099-01-01T00:0${move_number}:00.000Z`),
    }));
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
        () => submitMove(gameId, blackKey, { x: 0, y: 0 }),
      );
    });
  }
});

test("second score confirmation preserves the exact Chinese database and API contract", async () => {
  const initialGame = gameRow({ phase: "scoring", to_move: null, scoring_revision: 1 });
  const blackConfirmedAt = new Date("2099-01-01T00:03:00.000Z");
  const stoppedBoard = createEmptyBoard(9);
  stoppedBoard[0][1] = "black";
  stoppedBoard[1][0] = "black";
  stoppedBoard[8][8] = "white";
  const scoredBoard = stoppedBoard.map((row) => [...row]);
  scoredBoard[8][8] = null;
  const moveRows = [
    [1, "black", 1, 0, false],
    [2, "white", 8, 8, false],
    [3, "black", 0, 1, false],
    [4, "white", null, null, true],
    [5, "black", null, null, true],
  ].map(([move_number, color, x, y, is_pass]) => ({
    move_number,
    color,
    x,
    y,
    is_pass,
    board_hash: null,
    created_at: new Date(`2099-01-01T00:0${move_number}:00.000Z`),
  }));
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
            result: values[1],
            winner_key: values[2],
            finished_at: values[3],
            version: 2,
          })],
          rowCount: 1,
        };
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
    state = await confirmScore(gameId, whiteKey, 1);
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
  assert.deepEqual(gameFinishWrite, [gameId, "B+73.5", blackKey, finalizedAt]);
  assert.deepEqual(
    ratingLedgerWrites.map((values) => [values[0], values[5], values[6]]),
    [
      [blackKey, 16, "win"],
      [whiteKey, -16, "loss"],
    ],
  );
  assert.equal(state.winnerKey, blackKey);
  assert.equal(
    JSON.stringify(state.scoring?.preview),
    "{\"black\":81,\"white\":7.5,\"blackStones\":2,\"whiteStones\":0,\"blackTerritory\":79,\"whiteTerritory\":0,\"neutralPoints\":0,\"winner\":\"black\",\"margin\":73.5,\"result\":\"B+73.5\"}",
  );
});

test("resigning during scoring persists the canonical terminal lifecycle before ratings", async () => {
  const statements: string[] = [];
  const initialGame = gameRow({ phase: "scoring", to_move: null, scoring_revision: 1 });
  const finishedGame = gameRow({
    status: "finished",
    phase: "play",
    to_move: null,
    scoring_revision: 1,
    winner_key: blackKey,
    result: "B+R",
    finish_reason: "resignation",
    finished_at: new Date("2099-01-01T00:05:00.000Z"),
    version: 1,
  });
  const client = {
    async query(sql: string) {
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
  const scoringDelete = statements.findIndex((sql) => sql.startsWith("DELETE FROM game_scoring_state"));
  const gameFinish = statements.findIndex((sql) =>
    sql.includes("UPDATE games") && sql.includes("finish_reason = 'resignation'"),
  );
  const ratingWrite = statements.findIndex((sql) => sql.includes("INSERT INTO player_rating_history"));
  assert.ok(scoringDelete >= 0);
  assert.ok(gameFinish > scoringDelete);
  assert.ok(ratingWrite > gameFinish);
  assert.equal(statements.at(-1), "COMMIT");
});
