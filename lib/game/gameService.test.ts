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
import type { GameState } from "./types";

const gameId = "11111111-1111-4111-8111-111111111111";
const blackKey = "guest:black";

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
    board_hash: "snapshot",
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

async function withFakeDatabase(
  rows: { game: Record<string, unknown>; scoring: Record<string, unknown> | null },
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
      if (sql.includes("FROM moves")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM game_scoring_state")) {
        return { rows: rows.scoring ? [rows.scoring] : [], rowCount: rows.scoring ? 1 : 0 };
      }
      if (sql.includes("FROM game_dead_stones")) return { rows: [], rowCount: 0 };
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
  rows: { game: Record<string, unknown>; scoring: Record<string, unknown> | null },
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

  await t.test("an unknown agreement profile cannot inherit the Chinese resignation repair", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({
          status: "finished",
          phase: "scoring",
          to_move: null,
          scoring_revision: 1,
          winner_key: blackKey,
          result: "B+R",
          finish_reason: "resignation",
          finished_at: new Date("2099-01-01T00:05:00.000Z"),
          rules: "japanese",
          rules_profile: "japanese-1989-gostone-v1",
          scoring_method: "territory",
          komi: "6.5",
        }),
        scoring: scoringRow({
          rules: "japanese",
          rules_profile: "japanese-1989-gostone-v1",
          scoring_method: "territory",
          komi: "6.5",
        }),
      },
      "rules_configuration_unsupported",
      () => confirmScore(gameId, blackKey, 1),
    );
  });

  await t.test("an unknown immediate profile cannot inherit migration-008 normalization", async () => {
    await assertRejectedWithoutWrites(
      {
        game: gameRow({
          status: "finished",
          phase: "play",
          to_move: null,
          winner_key: blackKey,
          result: "B+2.5",
          finish_reason: null,
          finished_at: new Date("2099-01-01T00:05:00.000Z"),
          rules_profile: "chinese-2002-gostone-v2",
        }),
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
    const finalizedAt = new Date("2099-01-01T00:05:00.000Z");
    const state = await loadState(
      gameRow({
        status: "finished",
        phase: "scoring",
        to_move: null,
        scoring_revision: 1,
        result: "W+7.5",
        finish_reason: "score",
        finished_at: finalizedAt,
      }),
      scoringRow({
        black_confirmed_revision: 1,
        white_confirmed_revision: 1,
        black_confirmed_at: finalizedAt,
        white_confirmed_at: finalizedAt,
        scored_board_hash: "final",
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
      }),
    );
    assert.equal(state.finishReason, "score");
    assert.equal(state.scoring?.preview.result, "W+7.5");
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
      if (sql.includes("FROM moves")) return { rows: [], rowCount: 0 };
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
