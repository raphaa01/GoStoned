import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { Pool } from "pg";
import {
  confirmJapaneseScore,
  pollJapaneseGameState,
  resetJapaneseScoringSuggestion,
  resolveJapaneseScoringDeadline,
  resumeJapanesePlay,
  setJapaneseDeadGroup,
  submitJapaneseMove,
  undoJapaneseScoringChange,
} from "./japaneseGameService";
import { applyMove, boardHash, createEmptyBoard } from "./goEngine";
import { JAPANESE_1989_RULES_PROFILE } from "./japanesePolicyContract";
import { hashJapaneseSettlementProposalV1 } from "./japaneseSettlementProposal";
import { resetKataGoScoringRuntimeForTests } from "../katago/runtime";

const gameId = "11111111-1111-4111-8111-111111111111";
const blackKey = "guest:black";
const whiteKey = "guest:white";
const epoch = new Date("2099-01-01T00:00:00.000Z");
const emptyHash = boardHash(createEmptyBoard(9));

type Row = Record<string, unknown>;

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code: unknown }).code === code;
}

function gameRow(overrides: Row = {}): Row {
  return {
    id: gameId,
    board_size: 9,
    black_player_key: blackKey,
    white_player_key: whiteKey,
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
    komi: "6.5",
    rules: "japanese",
    rules_profile: JAPANESE_1989_RULES_PROFILE,
    scoring_method: "territory",
    handicap: 0,
    time_control: "rapid",
    main_time_seconds: 600,
    byo_yomi_periods: 5,
    byo_yomi_seconds: 30,
    black_time_remaining_ms: 600_000,
    white_time_remaining_ms: 600_000,
    black_periods_remaining: 5,
    white_periods_remaining: 5,
    turn_started_at: epoch,
    version: 0,
    started_at: epoch,
    finished_at: null,
    ...overrides,
  };
}

function pass(moveNumber: number, color: "black" | "white", hash = emptyHash): Row {
  return {
    move_number: moveNumber,
    color,
    x: null,
    y: null,
    is_pass: true,
    board_hash: hash,
    created_at: new Date(epoch.getTime() + moveNumber * 1_000),
  };
}

function emptyProposalHash(revision: number, stoppedMoveNumber = 2): string {
  return hashJapaneseSettlementProposalV1({
    gameId,
    stoppedBoardHash: emptyHash,
    stoppedMoveNumber,
    revision,
    rulesIdentity: {
      rules: "japanese",
      rulesProfile: JAPANESE_1989_RULES_PROFILE,
      scoringMethod: "territory",
      komi: 6.5,
      handicap: 0,
    },
    prisoners: { capturedWhiteByBlack: 0, capturedBlackByWhite: 0 },
    deadStones: [],
    neutralRegionSeeds: [],
  });
}

function scoringRow(overrides: Row = {}): Row {
  const revision = Number(overrides.revision ?? 1);
  return {
    game_id: gameId,
    board_hash: emptyHash,
    stopped_move_number: 2,
    revision,
    proposal_hash: emptyProposalHash(revision),
    rules: "japanese",
    rules_profile: JAPANESE_1989_RULES_PROFILE,
    scoring_method: "territory",
    komi: "6.5",
    handicap: 0,
    captured_white_by_black_at_stop: 0,
    captured_black_by_white_at_stop: 0,
    expires_at: new Date("2099-01-01T00:05:00.000Z"),
    black_participated_at: null,
    white_participated_at: null,
    suggestion_status: "ready",
    suggestion_request_identity: `sha256:${"a".repeat(64)}`,
    suggestion_provider_kind: "deterministic",
    suggestion_engine_version: "test-engine",
    suggestion_model_version: "test-model",
    suggestion_config_version: "test-config",
    suggestion_confidence_policy_version: "gostone-dead-groups-v1",
    suggestion_latency_ms: 1,
    suggestion_error_class: null,
    black_confirmed_revision: null,
    white_confirmed_revision: null,
    black_confirmed_proposal_hash: null,
    white_confirmed_proposal_hash: null,
    black_confirmed_at: null,
    white_confirmed_at: null,
    scored_board_hash: null,
    scored_proposal_hash: null,
    living_black_stones: null,
    living_white_stones: null,
    black_territory: null,
    white_territory: null,
    dame_points: null,
    territory_excluded_by_agreement: null,
    dead_black_stones: null,
    dead_white_stones: null,
    black_prisoners_final: null,
    white_prisoners_final: null,
    black_total: null,
    white_total: null,
    outcome_kind: null,
    winner: null,
    margin: null,
    started_at: epoch,
    updated_at: epoch,
    finalized_at: null,
    ...overrides,
  };
}

function proposalRow(scoring: Row, overrides: Row = {}): Row {
  return {
    scoring_revision: scoring.revision,
    parent_scoring_revision: null,
    source: "katago_initial",
    actor_color: null,
    proposal_hash: scoring.proposal_hash,
    dead_stones: [],
    neutral_region_seeds: [],
    created_at: epoch,
    ...overrides,
  };
}

type Store = {
  game: Row;
  moves: Row[];
  resumes: Row[];
  scoring: Row | null;
  dead: Row[];
  neutral: Row[];
  proposals: Row[];
  terminalWrites: Array<{ sql: string; values: unknown[] }>;
  statements: string[];
};

function protocolStore(input: Partial<Omit<Store, "statements">> = {}): Store {
  return {
    game: input.game ?? gameRow(),
    moves: input.moves ?? [],
    resumes: input.resumes ?? [],
    scoring: input.scoring ?? null,
    dead: input.dead ?? [],
    neutral: input.neutral ?? [],
    proposals: input.proposals ?? [],
    terminalWrites: input.terminalWrites ?? [],
    statements: [],
  };
}

function result(rows: Row[] = []) {
  return { rows, rowCount: rows.length };
}

async function withProtocol<T>(store: Store, action: () => Promise<T>): Promise<T> {
  const client = {
    async query(sql: string, values: unknown[] = []) {
      store.statements.push(sql);
      if (sql.startsWith("BEGIN") || sql.startsWith("SET LOCAL") || sql === "COMMIT" || sql === "ROLLBACK") {
        return result();
      }
      if (sql.includes("FROM games g")) return result([store.game]);
      if (sql.includes("FROM moves")) return result(store.moves);
      if (sql.includes("FROM game_japanese_repetition_claims")) return result();
      if (sql.trimStart().startsWith("SELECT") && sql.includes("FROM game_japanese_resume_authorizations")) return result(store.resumes);
      if (sql.trimStart().startsWith("SELECT") && sql.includes("FROM game_japanese_scoring_state")) return result(store.scoring ? [store.scoring] : []);
      if (sql.trimStart().startsWith("SELECT") && sql.includes("FROM game_japanese_dead_stones")) return result(store.dead);
      if (sql.trimStart().startsWith("SELECT") && sql.includes("FROM game_japanese_neutral_region_seeds")) return result(store.neutral);
      if (sql.trimStart().startsWith("SELECT") && sql.includes("FROM game_japanese_scoring_proposals")) {
        if (sql.includes("source='katago_initial'")) {
          return result(store.proposals.filter(({ source }) => source === "katago_initial").slice(-1));
        }
        const revision = Number(values[1]);
        return result(store.proposals.filter(({ scoring_revision }) => scoring_revision === revision));
      }
      if (sql.includes("FROM player_rating_history") && sql.includes("FOR UPDATE")) {
        return result();
      }
      if (sql.includes("FROM users") && sql.includes("UNION ALL")) {
        return result();
      }
      if (sql.includes("INSERT INTO moves")) {
        store.moves.push({
          move_number: values[1], color: values[2], x: values[3], y: values[4],
          is_pass: values[5], board_hash: values[6], created_at: values[7],
        });
        return result();
      }
      if (sql.includes("INSERT INTO game_japanese_scoring_state")) {
        store.scoring = scoringRow({
          board_hash: values[1], stopped_move_number: values[2], revision: values[3],
          proposal_hash: values[4], captured_white_by_black_at_stop: values[5],
          captured_black_by_white_at_stop: values[6], expires_at: values[7],
          suggestion_status: "pending", suggestion_request_identity: null,
          suggestion_provider_kind: null, suggestion_engine_version: null,
          suggestion_model_version: null, suggestion_config_version: null,
          suggestion_confidence_policy_version: null, suggestion_latency_ms: null,
        });
        return result();
      }
      if (sql.includes("INSERT INTO game_japanese_resume_authorizations")) {
        store.resumes.push({
          resumption_number: values[1], scoring_revision: values[2],
          stopped_move_number: values[3], stopped_board_hash: values[4],
          requested_by_color: values[5], authorized_at: new Date(),
        });
        return result();
      }
      if (sql.includes("INSERT INTO game_japanese_scoring_terminal_events")) {
        store.terminalWrites.push({ sql, values: [...values] });
        return result();
      }
      if (sql.includes("INSERT INTO game_japanese_scoring_proposals")) {
        const initial = sql.includes("'katago_initial'");
        store.proposals.push(initial ? {
          scoring_revision: values[1], parent_scoring_revision: null,
          stopped_move_number: values[2], proposal_hash: values[4],
          source: "katago_initial", actor_color: null,
          dead_stones: JSON.parse(String(values[5])), neutral_region_seeds: JSON.parse(String(values[6])),
          created_at: new Date(),
        } : {
          scoring_revision: values[1], parent_scoring_revision: values[2],
          stopped_move_number: values[3], proposal_hash: values[5],
          source: values[6], actor_color: values[7],
          dead_stones: JSON.parse(String(values[8])), neutral_region_seeds: JSON.parse(String(values[9])),
          created_at: new Date(),
        });
        return result();
      }
      if (sql.startsWith("DELETE FROM game_japanese_dead_stones")) {
        store.dead = [];
        return result();
      }
      if (sql.startsWith("DELETE FROM game_japanese_neutral_region_seeds")) {
        store.neutral = [];
        return result();
      }
      if (sql.startsWith("DELETE FROM game_japanese_scoring_state")) {
        store.scoring = null;
        return result();
      }
      if (sql.includes("INSERT INTO game_japanese_dead_stones")) {
        store.dead = (values[3] as number[]).map((x: number, index: number) => ({
          x, y: (values[4] as number[])[index], color: (values[5] as string[])[index],
        }));
        return result();
      }
      if (sql.includes("INSERT INTO game_japanese_neutral_region_seeds")) {
        store.neutral = (values[3] as number[]).map((x: number, index: number) => ({
          x, y: (values[4] as number[])[index],
        }));
        return result();
      }
      if (sql.includes("UPDATE game_japanese_scoring_state") && sql.includes("SET proposal_hash=$2")) {
        Object.assign(store.scoring!, {
          proposal_hash: values[1], suggestion_status: "ready",
          suggestion_request_identity: values[2], suggestion_provider_kind: values[3],
          suggestion_engine_version: values[4], suggestion_model_version: values[5],
          suggestion_config_version: values[6], suggestion_confidence_policy_version: values[7],
          suggestion_latency_ms: values[8], updated_at: values[9],
        });
        return result([store.scoring!]);
      }
      if (sql.includes("UPDATE game_japanese_scoring_state") && sql.includes("suggestion_status = $2")) {
        Object.assign(store.scoring!, {
          suggestion_status: values[1], suggestion_request_identity: values[2],
          suggestion_provider_kind: values[3], suggestion_engine_version: values[4],
          suggestion_model_version: values[5], suggestion_config_version: values[6],
          suggestion_confidence_policy_version: values[7], suggestion_latency_ms: values[8],
          suggestion_error_class: values[9], updated_at: new Date(),
        });
        return result([store.scoring!]);
      }
      if (sql.includes("UPDATE game_japanese_scoring_state") && sql.includes("SET revision = $2")) {
        Object.assign(store.scoring!, {
          revision: values[1], proposal_hash: values[2],
          black_confirmed_revision: null, white_confirmed_revision: null,
          black_confirmed_proposal_hash: null, white_confirmed_proposal_hash: null,
          black_confirmed_at: null, white_confirmed_at: null, updated_at: values[3],
        });
        if (sql.includes("black_participated_at")) store.scoring!.black_participated_at ??= values[3];
        if (sql.includes("white_participated_at")) store.scoring!.white_participated_at ??= values[3];
        return result([store.scoring!]);
      }
      if (sql.includes("UPDATE game_japanese_scoring_state SET") && sql.includes("_confirmed_revision=$2")) {
        const color = sql.includes("black_confirmed_revision") ? "black" : "white";
        store.scoring![`${color}_confirmed_revision`] = values[1];
        store.scoring![`${color}_confirmed_proposal_hash`] = values[2];
        store.scoring![`${color}_confirmed_at`] = values[3];
        store.scoring![`${color}_participated_at`] ??= values[3];
        store.scoring!.updated_at = values[3];
        return result([store.scoring!]);
      }
      if (sql.includes("UPDATE game_japanese_scoring_state SET scored_board_hash")) {
        const keys = [
          "scored_board_hash", "living_black_stones", "living_white_stones", "black_territory",
          "white_territory", "dame_points", "territory_excluded_by_agreement", "dead_black_stones",
          "dead_white_stones", "black_prisoners_final", "white_prisoners_final", "black_total",
          "white_total", "outcome_kind", "winner", "margin", "finalized_at",
        ];
        keys.forEach((key, index) => { store.scoring![key] = values[index + 1]; });
        store.scoring!.scored_proposal_hash = store.scoring!.proposal_hash;
        return result([store.scoring!]);
      }
      if (sql.includes("UPDATE games SET phase='scoring'")) {
        Object.assign(store.game, {
          phase: "scoring", to_move: null, consecutive_passes: 2,
          scoring_revision: values[1], black_time_remaining_ms: values[2],
          white_time_remaining_ms: values[3], black_periods_remaining: values[4],
          white_periods_remaining: values[5], updated_at: values[6],
          version: Number(store.game.version) + 1,
        });
        return result([store.game]);
      }
      if (sql.includes("UPDATE games SET phase='play',to_move=$2")) {
        Object.assign(store.game, {
          phase: "play", to_move: values[1], consecutive_passes: 0,
          scoring_revision: Number(store.game.scoring_revision) + 1,
          turn_started_at: values[2], updated_at: values[3],
          version: Number(store.game.version) + 1,
        });
        return result([store.game]);
      }
      if (sql.includes("UPDATE games SET scoring_revision = $2")) {
        Object.assign(store.game, {
          scoring_revision: values[1], updated_at: values[2],
          version: Number(store.game.version) + 1,
        });
        return result([store.game]);
      }
      if (
        sql.includes("UPDATE games SET version=version+1")
        || sql.includes("UPDATE games SET version = version + 1")
      ) {
        store.game.version = Number(store.game.version) + 1;
        store.game.updated_at = values[1] ?? new Date();
        return result([store.game]);
      }
      if (sql.includes("UPDATE games SET status='finished', phase='scoring'")) {
        Object.assign(store.game, {
          status: "finished", phase: "scoring", to_move: null,
          finish_reason: "score", result: values[1], winner_key: values[2],
          finished_at: values[3], updated_at: values[3],
          version: Number(store.game.version) + 1,
        });
        return result([store.game]);
      }
      if (sql.includes("UPDATE games SET status='finished',phase='play'")) {
        Object.assign(store.game, {
          status: "finished", phase: "play", to_move: null,
          finish_reason: values[1], result: values[2], winner_key: values[3],
          finished_at: values[4], updated_at: values[4],
          version: Number(store.game.version) + 1,
        });
        return result([store.game]);
      }
      throw new Error(`Unexpected Japanese service SQL: ${sql}`);
    },
    release() {},
  };
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = {
    query: client.query,
    connect: async () => client,
  } as unknown as Pool;
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previous;
  }
}

async function withDeterministicKataGo<T>(action: () => Promise<T>): Promise<T> {
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  const names = [
    "NODE_ENV", "KATAGO_SCORING_PROVIDER", "KATAGO_ENGINE_VERSION",
    "KATAGO_MODEL_VERSION", "KATAGO_CONFIG_VERSION",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    KATAGO_SCORING_PROVIDER: "deterministic",
    KATAGO_ENGINE_VERSION: "test-engine",
    KATAGO_MODEL_VERSION: "test-model",
    KATAGO_CONFIG_VERSION: "test-config",
  });
  resetKataGoScoringRuntimeForTests();
  try {
    return await action();
  } finally {
    resetKataGoScoringRuntimeForTests();
    for (const name of names) {
      if (previous[name] === undefined) delete mutableEnvironment[name];
      else mutableEnvironment[name] = previous[name];
    }
  }
}

async function withUnavailableKataGo<T>(action: () => Promise<T>): Promise<T> {
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  const names = [
    "NODE_ENV", "KATAGO_SCORING_PROVIDER", "KATAGO_ENGINE_VERSION",
    "KATAGO_MODEL_VERSION", "KATAGO_CONFIG_VERSION",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  mutableEnvironment.NODE_ENV = "test";
  for (const name of names.slice(1)) delete mutableEnvironment[name];
  resetKataGoScoringRuntimeForTests();
  try {
    return await action();
  } finally {
    resetKataGoScoringRuntimeForTests();
    for (const name of names) {
      if (previous[name] === undefined) delete mutableEnvironment[name];
      else mutableEnvironment[name] = previous[name];
    }
  }
}

test("pass-pass creates one stopped boundary and persists one initial KataGo suggestion", async () => {
  const store = protocolStore({
    game: gameRow({ to_move: "white", consecutive_passes: 1, version: 3 }),
    moves: [pass(1, "black")],
  });
  const state = await withDeterministicKataGo(() => withProtocol(store, () =>
    submitJapaneseMove(gameId, whiteKey, { isPass: true, expectedVersion: 3 })));

  assert.equal(state.phase, "scoring");
  assert.equal(state.scoring?.suggestion?.status, "ready");
  assert.equal(store.proposals.filter(({ source }) => source === "katago_initial").length, 1);
  assert.equal(store.statements.filter((sql) => sql.includes("INSERT INTO game_japanese_scoring_state")).length, 1);
  assert.equal(store.statements.filter((sql) => sql.includes("INSERT INTO game_japanese_scoring_proposals")).length, 1);
});

test("an unavailable initial KataGo request preserves bounded diagnostics and permits manual confirmation", async () => {
  const store = protocolStore({
    game: gameRow({ to_move: "white", consecutive_passes: 1, version: 3 }),
    moves: [pass(1, "black")],
  });
  const unavailable = await withUnavailableKataGo(() => withProtocol(store, () =>
    submitJapaneseMove(gameId, whiteKey, { isPass: true, expectedVersion: 3 })));
  assert.equal(unavailable.scoring?.suggestion?.status, "unavailable");
  assert.equal(store.scoring?.suggestion_error_class, "provider_not_configured");
  assert.equal(store.scoring?.suggestion_request_identity, null);
  assert.equal(store.proposals.length, 0);

  const manual = await withProtocol(store, () => confirmJapaneseScore(
    gameId, blackKey, unavailable.scoringRevision,
  ));
  assert.equal(manual.status, "active");
  assert.equal(manual.scoring?.blackConfirmed, true);
});

test("move submission rejects an immediate Japanese ko recapture before persistence", async () => {
  const setup = [
    ["black", 0, 1], ["white", 1, 1], ["black", 2, 1],
    ["white", 0, 2], ["black", 1, 0], ["white", 2, 2],
    ["black", 8, 8], ["white", 1, 3], ["black", 1, 2],
  ] as const;
  let board = createEmptyBoard(9);
  const moves: Row[] = [];
  for (const [color, x, y] of setup) {
    const applied = applyMove(board, color, x, y);
    assert.equal(applied.ok, true);
    if (!applied.ok) throw new Error("ko test fixture contains an illegal setup move");
    board = applied.board;
    moves.push({
      move_number: moves.length + 1, color, x, y, is_pass: false,
      board_hash: boardHash(board), created_at: epoch,
    });
  }
  const store = protocolStore({
    game: gameRow({ to_move: "white", version: 9 }),
    moves,
  });
  await assert.rejects(
    withProtocol(store, () => submitJapaneseMove(
      gameId, whiteKey, { x: 1, y: 1, expectedVersion: 9 },
    )),
    (error: unknown) => hasErrorCode(error, "ko"),
  );
  assert.equal(
    store.statements.some((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)),
    false,
  );
});

test("a player edit advances the authoritative revision and clears prior confirmation", async () => {
  const played = [
    ["black", 1, 1], ["white", 0, 1], ["black", 8, 8], ["white", 1, 0],
    ["black", 8, 7], ["white", 2, 1], ["black", 7, 8], ["white", 0, 3],
    ["black", 7, 7], ["white", 1, 3], ["black", 8, 6], ["white", 2, 3],
    ["black", 6, 8], ["white", 2, 2], ["black", 6, 7],
  ] as const;
  let board = createEmptyBoard(9);
  const moves: Row[] = [];
  for (const [color, x, y] of played) {
    const applied = applyMove(board, color, x, y);
    assert.equal(applied.ok, true);
    if (!applied.ok) throw new Error("test fixture contains an illegal move");
    board = applied.board;
    moves.push({
      move_number: moves.length + 1, color, x, y, is_pass: false,
      board_hash: boardHash(board), created_at: epoch,
    });
  }
  const stoppedHash = boardHash(board);
  moves.push(pass(16, "white", stoppedHash), pass(17, "black", stoppedHash));
  const hash = hashJapaneseSettlementProposalV1({
    gameId, stoppedBoardHash: stoppedHash, stoppedMoveNumber: 17, revision: 1,
    rulesIdentity: { rules: "japanese", rulesProfile: JAPANESE_1989_RULES_PROFILE, scoringMethod: "territory", komi: 6.5, handicap: 0 },
    prisoners: { capturedWhiteByBlack: 0, capturedBlackByWhite: 0 },
    deadStones: [], neutralRegionSeeds: [],
  });
  const scoring = scoringRow({
    board_hash: stoppedHash, stopped_move_number: 17, proposal_hash: hash,
    black_confirmed_revision: 1, black_confirmed_proposal_hash: hash,
    black_confirmed_at: epoch, black_participated_at: epoch,
  });
  const store = protocolStore({
    game: gameRow({ phase: "scoring", to_move: null, consecutive_passes: 2, scoring_revision: 1 }),
    moves, scoring, proposals: [proposalRow(scoring)],
  });

  const state = await withProtocol(store, () => setJapaneseDeadGroup(
    gameId, whiteKey, { x: 1, y: 1, dead: true, expectedRevision: 1 },
  ));
  assert.equal(state.scoringRevision, 2);
  assert.equal(state.scoring?.blackConfirmed, false);
  assert.equal(state.scoring?.whiteConfirmed, false);
  assert.deepEqual(state.scoring?.deadStones, [{ x: 1, y: 1 }]);
  assert.equal(state.scoring?.whiteParticipated, true);
});

test("resume grants the requester's opponent the next move and closes scoring evidence", async () => {
  const scoring = scoringRow();
  const store = protocolStore({
    game: gameRow({ phase: "scoring", to_move: null, consecutive_passes: 2, scoring_revision: 1 }),
    moves: [pass(1, "black"), pass(2, "white")],
    scoring,
    proposals: [proposalRow(scoring)],
  });
  const state = await withProtocol(store, () => resumeJapanesePlay(gameId, blackKey, 1));
  assert.equal(state.phase, "play");
  assert.equal(state.turn, "white");
  assert.equal(state.scoring, null);
  const insert = store.statements.findIndex((sql) => sql.includes("INSERT INTO game_japanese_resume_authorizations"));
  const transition = store.statements.findIndex((sql) => sql.includes("UPDATE games SET phase='play'"));
  const deletion = store.statements.findIndex((sql) => sql.includes("DELETE FROM game_japanese_scoring_state"));
  assert.ok(insert < transition && transition < deletion);
});

test("the fourth scoring resume is rejected before any write", async () => {
  const moves = [
    pass(1, "black"), pass(2, "white"), pass(3, "white"), pass(4, "black"),
    pass(5, "black"), pass(6, "white"), pass(7, "white"), pass(8, "black"),
  ];
  const resumes = [
    { resumption_number: 1, scoring_revision: 1, stopped_move_number: 2, stopped_board_hash: emptyHash, requested_by_color: "black", authorized_at: epoch },
    { resumption_number: 2, scoring_revision: 3, stopped_move_number: 4, stopped_board_hash: emptyHash, requested_by_color: "white", authorized_at: epoch },
    { resumption_number: 3, scoring_revision: 5, stopped_move_number: 6, stopped_board_hash: emptyHash, requested_by_color: "black", authorized_at: epoch },
  ];
  const scoring = scoringRow({ revision: 7, stopped_move_number: 8, proposal_hash: emptyProposalHash(7, 8) });
  const store = protocolStore({
    game: gameRow({ phase: "scoring", to_move: null, consecutive_passes: 2, scoring_revision: 7 }),
    moves, resumes, scoring, proposals: [proposalRow(scoring)],
  });
  await assert.rejects(
    withProtocol(store, () => resumeJapanesePlay(gameId, blackKey, 7)),
    (error: unknown) => hasErrorCode(error, "resumption_limit_reached"),
  );
  assert.equal(store.statements.some((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)), false);
});

test("matching confirmations finalize once and a retry is idempotent", async () => {
  const scoring = scoringRow();
  const store = protocolStore({
    game: gameRow({ phase: "scoring", to_move: null, consecutive_passes: 2, scoring_revision: 1 }),
    moves: [pass(1, "black"), pass(2, "white")],
    scoring, proposals: [proposalRow(scoring)],
  });
  const first = await withProtocol(store, () => confirmJapaneseScore(gameId, blackKey, 1));
  assert.equal(first.status, "active");
  const finished = await withProtocol(store, () => confirmJapaneseScore(gameId, whiteKey, 1));
  assert.equal(finished.status, "finished");
  assert.equal(finished.result, "W+6.5");
  const finishWrites = () => store.statements.filter((sql) => sql.includes("finish_reason='score'")).length;
  assert.equal(finishWrites(), 1);
  const retried = await withProtocol(store, () => confirmJapaneseScore(gameId, whiteKey, 1));
  assert.equal(retried.status, "finished");
  assert.equal(finishWrites(), 1);
  assert.ok(store.statements.some((sql) => sql.includes("FOR UPDATE OF g")), "confirmation must lock the game first");
});

test("finished Japanese reads reject every tampered final-score evidence field", async () => {
  const scoring = scoringRow();
  const store = protocolStore({
    game: gameRow({ phase: "scoring", to_move: null, consecutive_passes: 2, scoring_revision: 1 }),
    moves: [pass(1, "black"), pass(2, "white")],
    scoring, proposals: [proposalRow(scoring)],
  });
  await withProtocol(store, () => confirmJapaneseScore(gameId, blackKey, 1));
  await withProtocol(store, () => confirmJapaneseScore(gameId, whiteKey, 1));
  const finalEvidence = { ...store.scoring! };
  const tampering: ReadonlyArray<readonly [string, unknown]> = [
    ["scored_board_hash", "tampered"],
    ["living_black_stones", 1],
    ["living_white_stones", 1],
    ["dame_points", 80],
    ["territory_excluded_by_agreement", 1],
    ["dead_black_stones", 1],
    ["dead_white_stones", 1],
    ["outcome_kind", "jigo"],
  ];
  for (const [field, value] of tampering) {
    store.scoring = { ...finalEvidence, [field]: value };
    const before = store.statements.length;
    await assert.rejects(
      withProtocol(store, () => pollJapaneseGameState(gameId, blackKey, null)),
      (error: unknown) => hasErrorCode(error, "japanese_game_evidence_mismatch"),
      field,
    );
    assert.equal(
      store.statements.slice(before).some((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)),
      false,
      `${field} corruption must fail before writes`,
    );
  }
});

test("an expired phase with no participation finishes no-result without KataGo", async () => {
  const scoring = scoringRow({ expires_at: new Date("2000-01-01T00:00:00.000Z") });
  const store = protocolStore({
    game: gameRow({ phase: "scoring", to_move: null, consecutive_passes: 2, scoring_revision: 1 }),
    moves: [pass(1, "black"), pass(2, "white")], scoring, proposals: [proposalRow(scoring)],
  });
  const previousProvider = process.env.KATAGO_SCORING_PROVIDER;
  delete process.env.KATAGO_SCORING_PROVIDER;
  try {
    const state = await withProtocol(store, () => resolveJapaneseScoringDeadline(gameId, blackKey, 1));
    assert.equal(state.status, "finished");
    assert.equal(state.finishReason, "japanese_no_result");
    assert.equal(state.result, "Void");
  } finally {
    if (previousProvider === undefined) delete process.env.KATAGO_SCORING_PROVIDER;
    else process.env.KATAGO_SCORING_PROVIDER = previousProvider;
  }
});

test("an expired phase records abandonment when exactly one player participated", async () => {
  const scoring = scoringRow({
    started_at: new Date("1999-12-31T23:55:00.000Z"),
    expires_at: new Date("2000-01-01T00:00:00.000Z"),
    black_participated_at: new Date("1999-12-31T23:59:00.000Z"),
  });
  const store = protocolStore({
    game: gameRow({ phase: "scoring", to_move: null, consecutive_passes: 2, scoring_revision: 1 }),
    moves: [pass(1, "black"), pass(2, "white")], scoring, proposals: [proposalRow(scoring)],
  });
  const previousProvider = process.env.KATAGO_SCORING_PROVIDER;
  delete process.env.KATAGO_SCORING_PROVIDER;
  try {
    const state = await withProtocol(store, () => resolveJapaneseScoringDeadline(gameId, blackKey, 1));
    assert.equal(state.status, "finished");
    assert.equal(state.finishReason, "japanese_abandonment");
    assert.equal(state.result, "B+F");
    assert.equal(state.winnerKey, blackKey);
  } finally {
    if (previousProvider === undefined) delete process.env.KATAGO_SCORING_PROVIDER;
    else process.env.KATAGO_SCORING_PROVIDER = previousProvider;
  }
});

test("two participants receive a fresh, independently bound KataGo deadline adjudication", async () => {
  const scoring = scoringRow({
    started_at: new Date("1999-12-31T23:55:00.000Z"),
    expires_at: new Date("2000-01-01T00:00:00.000Z"),
    black_participated_at: new Date("1999-12-31T23:58:00.000Z"),
    white_participated_at: new Date("1999-12-31T23:59:00.000Z"),
  });
  const store = protocolStore({
    game: gameRow({ phase: "scoring", to_move: null, consecutive_passes: 2, scoring_revision: 1 }),
    moves: [pass(1, "black"), pass(2, "white")], scoring, proposals: [proposalRow(scoring)],
  });
  const state = await withDeterministicKataGo(() => withProtocol(store, () =>
    resolveJapaneseScoringDeadline(gameId, blackKey, 1)));
  assert.equal(state.status, "finished");
  assert.equal(state.finishReason, "japanese_adjudication");
  assert.equal(state.result, "W+6.5");
  assert.equal(store.terminalWrites.length, 1);
  const terminal = store.terminalWrites[0];
  assert.equal(terminal.values[5], "katago_validated");
  assert.match(String(terminal.values[11]), /^[0-9a-f]{64}$/);
  assert.equal(terminal.values[12], "[]");
  assert.equal(terminal.values[13], "[]");
  assert.match(String(terminal.values[14]), /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(terminal.values[14], scoring.suggestion_request_identity);
  assert.doesNotMatch(terminal.sql, /\bresult\b/);
});

test("deadline KataGo unavailability finishes no-result with bounded failure evidence", async () => {
  const scoring = scoringRow({
    started_at: new Date("1999-12-31T23:55:00.000Z"),
    expires_at: new Date("2000-01-01T00:00:00.000Z"),
    black_participated_at: new Date("1999-12-31T23:58:00.000Z"),
    white_participated_at: new Date("1999-12-31T23:59:00.000Z"),
  });
  const store = protocolStore({
    game: gameRow({ phase: "scoring", to_move: null, consecutive_passes: 2, scoring_revision: 1 }),
    moves: [pass(1, "black"), pass(2, "white")], scoring, proposals: [proposalRow(scoring)],
  });
  const state = await withUnavailableKataGo(() => withProtocol(store, () =>
    resolveJapaneseScoringDeadline(gameId, blackKey, 1)));
  assert.equal(state.status, "finished");
  assert.equal(state.finishReason, "japanese_no_result");
  assert.equal(state.result, "Void");
  assert.equal(store.terminalWrites.length, 1);
  const terminal = store.terminalWrites[0].values;
  assert.equal(terminal[5], "katago_unavailable");
  assert.deepEqual(terminal.slice(11, 20), Array.from({ length: 9 }, () => null));
  assert.equal(typeof terminal[20], "number");
  assert.equal(terminal[21], "provider_not_configured");
  assert.ok(terminal.slice(22).every((value) => value === null));
});

test("polling performs read-only persistence work and never initializes KataGo", async () => {
  const scoring = scoringRow();
  const store = protocolStore({
    game: gameRow({ phase: "scoring", to_move: null, consecutive_passes: 2, scoring_revision: 1, version: 9 }),
    moves: [pass(1, "black"), pass(2, "white")], scoring, proposals: [proposalRow(scoring)],
  });
  const previousProvider = process.env.KATAGO_SCORING_PROVIDER;
  delete process.env.KATAGO_SCORING_PROVIDER;
  try {
    const poll = await withProtocol(store, () => pollJapaneseGameState(gameId, blackKey, 9));
    assert.equal(poll.unchanged, true);
    assert.ok(store.statements.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    assert.equal(store.statements.some((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)), false);
  } finally {
    if (previousProvider === undefined) delete process.env.KATAGO_SCORING_PROVIDER;
    else process.env.KATAGO_SCORING_PROVIDER = previousProvider;
  }
});

test("pending suggestion serialization exposes no unavailable undo or reset action", async () => {
  const scoring = scoringRow({
    suggestion_status: "pending", suggestion_request_identity: null,
    suggestion_provider_kind: null, suggestion_engine_version: null,
    suggestion_model_version: null, suggestion_config_version: null,
    suggestion_confidence_policy_version: null, suggestion_latency_ms: null,
  });
  const store = protocolStore({
    game: gameRow({ phase: "scoring", to_move: null, consecutive_passes: 2, scoring_revision: 1 }),
    moves: [pass(1, "black"), pass(2, "white")], scoring, proposals: [],
  });
  const poll = await withProtocol(store, () => pollJapaneseGameState(gameId, blackKey, null));
  assert.equal(poll.unchanged, false);
  if (poll.unchanged) return;
  assert.equal(poll.game.scoring?.suggestion?.status, "pending");
  assert.equal(poll.game.scoring?.canUndo, false);
  assert.equal(poll.game.scoring?.canResetToSuggestion, false);
});

test("pending and expired scoring boundaries reject every player scoring mutation before writes", async (t) => {
  const actions = [
    ["edit", () => setJapaneseDeadGroup(gameId, blackKey, { x: 0, y: 0, dead: true, expectedRevision: 1 })],
    ["undo", () => undoJapaneseScoringChange(gameId, blackKey, 1)],
    ["reset", () => resetJapaneseScoringSuggestion(gameId, blackKey, 1)],
    ["confirm", () => confirmJapaneseScore(gameId, blackKey, 1)],
    ["resume", () => resumeJapanesePlay(gameId, blackKey, 1)],
  ] as const;

  for (const boundary of ["pending", "expired"] as const) {
    await t.test(boundary, async () => {
      for (const [name, action] of actions) {
        const scoring = scoringRow(boundary === "pending" ? {
          suggestion_status: "pending", suggestion_request_identity: null,
          suggestion_provider_kind: null, suggestion_engine_version: null,
          suggestion_model_version: null, suggestion_config_version: null,
          suggestion_confidence_policy_version: null, suggestion_latency_ms: null,
        } : { expires_at: new Date("2000-01-01T00:00:00.000Z") });
        const store = protocolStore({
          game: gameRow({ phase: "scoring", to_move: null, consecutive_passes: 2, scoring_revision: 1 }),
          moves: [pass(1, "black"), pass(2, "white")], scoring,
          proposals: boundary === "pending" ? [] : [proposalRow(scoring)],
        });
        await assert.rejects(
          withProtocol(store, action),
          (error: unknown) => hasErrorCode(error, boundary === "pending"
            ? "scoring_suggestion_pending" : "scoring_deadline_expired"),
          `${boundary} ${name}`,
        );
        assert.equal(
          store.statements.some((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)),
          false,
          `${boundary} ${name} must not write`,
        );
      }
    });
  }
});

const serviceSource = readFileSync(join(process.cwd(), "lib/game/japaneseGameService.ts"), "utf8");
const dispatchSource = readFileSync(join(process.cwd(), "lib/game/gameService.ts"), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.notEqual(first, -1, `missing source marker ${start}`);
  assert.notEqual(last, -1, `missing source marker ${end}`);
  return source.slice(first, last);
}

test("SQL sequencing keeps append-only evidence ahead of each destructive transition", () => {
  const resume = sourceBetween(serviceSource, "export async function resumeJapanesePlay", "function proposalAdjudicationSafe");
  assert.ok(resume.indexOf("INSERT INTO game_japanese_resume_authorizations") < resume.indexOf("UPDATE games SET phase='play'"));
  assert.ok(resume.indexOf("UPDATE games SET phase='play'") < resume.indexOf("DELETE FROM game_japanese_scoring_state"));

  const deadline = sourceBetween(serviceSource, "async function finishJapaneseDeadline", "export async function resolveJapaneseScoringDeadline");
  assert.ok(deadline.indexOf("INSERT INTO game_japanese_scoring_terminal_events") < deadline.indexOf("UPDATE games SET status='finished'"));
  assert.ok(deadline.indexOf("UPDATE games SET status='finished'") < deadline.indexOf("DELETE FROM game_japanese_scoring_state"));

  const confirm = sourceBetween(serviceSource, "export async function confirmJapaneseScore", "export async function resumeJapanesePlay");
  assert.ok(confirm.indexOf("UPDATE game_japanese_scoring_state SET scored_board_hash") < confirm.indexOf("finish_reason='score'"));
});

test("profile dispatch isolates Japanese activation from the retained Chinese service", () => {
  assert.match(dispatchSource, /SELECT rules_profile FROM games WHERE id = \$1/);
  assert.match(dispatchSource, /rules_profile === JAPANESE_1989_RULES_PROFILE/);
  for (const pair of [
    ["pollJapaneseGameState", "pollChineseGameState"],
    ["getJapaneseGameState", "getChineseGameState"],
    ["submitJapaneseMove", "submitChineseMove"],
    ["setJapaneseDeadGroup", "setChineseDeadGroup"],
    ["confirmJapaneseScore", "confirmChineseScore"],
    ["resignJapaneseGame", "resignChineseGame"],
  ]) {
    assert.ok(dispatchSource.includes(pair[0]) && dispatchSource.includes(pair[1]));
  }
});

test("Japanese scoring mutation routes preserve the authenticated mutation guard sequence", () => {
  for (const name of ["confirm", "resume", "reset", "undo", "resolve-deadline"]) {
    const route = readFileSync(
      join(process.cwd(), "app/api/games/[gameId]/scoring", name, "route.ts"),
      "utf8",
    );
    const metadata = route.indexOf("assertGameMutationMetadata");
    const identity = route.indexOf("resolvePlayerKey", metadata);
    const binding = route.indexOf("assertExpectedPlayer", identity);
    const rateLimit = route.indexOf("consumePolicyRateLimit", binding);
    const serviceCall = route.indexOf("const game = await", rateLimit);
    assert.ok(metadata >= 0 && metadata < identity && identity < binding && binding < rateLimit && rateLimit < serviceCall, name);
  }
});

test("all eligible Japanese terminal transitions invoke the shared rating boundary in the same transaction", () => {
  const source = readFileSync(join(process.cwd(), "lib/game/japaneseGameService.ts"), "utf8");
  assert.equal(source.match(/await recordLegacyFinishedStats\(/g)?.length, 5);
});

test("Japanese move clocks bind timestamp columns through separate PostgreSQL parameters", () => {
  const source = readFileSync(join(process.cwd(), "lib/game/japaneseGameService.ts"), "utf8");
  assert.match(source, /turn_started_at=\$8, updated_at=\$9/);
  assert.match(source, /turn_started_at=\$3,updated_at=\$4/);
  assert.match(source, /\.\.\.clockAssignments,\s+now,\s+now,/);
});
