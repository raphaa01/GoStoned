import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { GameServiceError } from "./gameServiceError";
import { exportPersistedGameToSgf } from "./gameSgfService";

const gameId = "11111111-1111-4111-8111-111111111111";
const blackKey = "user:22222222-2222-4222-8222-222222222222";
const whiteKey = "user:33333333-3333-4333-8333-333333333333";

function gameRow(overrides: Record<string, unknown> = {}) {
  return {
    id: gameId,
    board_size: 9,
    black_player_key: blackKey,
    white_player_key: whiteKey,
    winner_key: blackKey,
    status: "finished",
    result: "B+F",
    finish_reason: "japanese_abandonment",
    rules: "japanese",
    rules_profile: "japanese-1989-gostone-v1",
    scoring_method: "territory",
    komi: "6.5",
    handicap: 0,
    black_player_name: "Black [player]",
    white_player_name: "White player",
    ...overrides,
  };
}

function installPool(
  t: test.TestContext,
  game: Record<string, unknown> | undefined,
  outcomeKind = "abandonment",
  options: { moves?: Record<string, unknown>[]; repetition?: Record<string, unknown>[] } = {},
) {
  const previous = globalThis.goStonedDbPool;
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (/SELECT g\.id,g\.board_size/.test(sql)) return { rows: game ? [game] : [] };
      if (/FROM moves/.test(sql)) return { rows: options.moves ?? [] };
      if (/FROM game_japanese_scoring_terminal_events/.test(sql)) {
        return { rows: [{ outcome_kind: outcomeKind }] };
      }
      if (/FROM game_japanese_repetition_claims/.test(sql)) {
        return { rows: options.repetition ?? [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  globalThis.goStonedDbPool = { connect: async () => client } as unknown as Pool;
  t.after(() => { globalThis.goStonedDbPool = previous; });
  return statements;
}

test("exports a participant-only Japanese abandonment as a transparent SGF forfeit", async (t) => {
  const statements = installPool(t, gameRow());
  const sgf = await exportPersistedGameToSgf(gameId, blackKey);
  assert.match(sgf, /RU\[japanese-1989-gostone-v1\]/);
  assert.match(sgf, /RE\[B\+F\]/);
  assert.ok(sgf.includes("PB[Black [player\\]]"));
  assert.ok(statements.some((sql) => sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
  assert.equal(statements.at(-1), "COMMIT");
});

test("keeps Japanese no-result distinct from a draw", async (t) => {
  installPool(t, gameRow({
    winner_key: null,
    result: "Void",
    finish_reason: "japanese_no_result",
  }), "katago_low_confidence");
  const sgf = await exportPersistedGameToSgf(gameId, whiteKey);
  assert.match(sgf, /RE\[Void\]/);
  assert.match(sgf, /GSNR\[adjudication-low-confidence\]/);
  assert.doesNotMatch(sgf, /RE\[0\]/);
});

test("exports mutually claimed whole-board repetition as a cyclic no-result", async (t) => {
  installPool(t, gameRow({
    winner_key: null,
    result: "Void",
    finish_reason: "japanese_repetition",
  }), "abandonment", {
    moves: Array.from({ length: 7 }, (_, index) => ({
      move_number: index + 1,
      color: index % 2 === 0 ? "black" : "white",
      x: index,
      y: 0,
      is_pass: false,
    })),
    repetition: [{ move_number: 7, claimant_count: 2 }],
  });
  const sgf = await exportPersistedGameToSgf(gameId, blackKey);
  assert.match(sgf, /RE\[Void\]/);
  assert.match(sgf, /GSNR\[cyclic-repetition\]/);
});

test("rejects outsiders and unfinished games before exporting", async (t) => {
  await t.test("outsider", async (child) => {
    installPool(child, gameRow());
    await assert.rejects(
      exportPersistedGameToSgf(gameId, "guest:outsider"),
      (error: unknown) => error instanceof GameServiceError
        && error.code === "not_a_participant",
    );
  });
  await t.test("unfinished", async (child) => {
    installPool(child, gameRow({ status: "active", finish_reason: null, result: null }));
    await assert.rejects(
      exportPersistedGameToSgf(gameId, blackKey),
      (error: unknown) => error instanceof GameServiceError
        && error.code === "game_not_finished",
    );
  });
});

test("fails closed when decisive persisted result evidence contradicts the winner", async (t) => {
  installPool(t, gameRow({
    finish_reason: "score",
    result: "W+0.5",
    winner_key: blackKey,
  }));
  await assert.rejects(
    exportPersistedGameToSgf(gameId, blackKey),
    (error: unknown) => error instanceof GameServiceError
      && error.code === "sgf_export_evidence_invalid",
  );
});
