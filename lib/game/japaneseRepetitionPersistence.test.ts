import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("db/migrations/025_japanese_whole_board_repetition.sql");
const schema = read("db/schema.sql");
const service = read("lib/game/japaneseGameService.ts");
const route = read("app/api/games/[gameId]/repetition/claim/route.ts");
const preflight = read("scripts/check-mvp.ts");

test("fresh and upgraded databases share exact append-only repetition evidence", () => {
  for (const sql of [migration, schema]) {
    for (const fragment of [
      "game_japanese_repetition_claims_pkey",
      "game_japanese_repetition_claims_move_fk",
      "game_japanese_repetition_claims_prior_move_fk",
      "game_japanese_repetition_claims_game_rules_fk",
      "validate_japanese_repetition_claim_insert",
      "validate_japanese_repetition_claim_commit",
      "guard_japanese_repetition_finish",
      "guard_japanese_repetition_claim_mutation",
      "ENABLE ROW LEVEL SECURITY",
      "REVOKE ALL ON game_japanese_repetition_claims FROM PUBLIC",
      "japanese_repetition",
    ]) assert.ok(sql.includes(fragment), `missing ${fragment}`);
  }
  assert.match(migration, /BEFORE UPDATE OR DELETE ON game_japanese_repetition_claims/);
  assert.match(migration, /BEFORE TRUNCATE ON game_japanese_repetition_claims/);
  assert.match(migration, /current_move\.is_pass/);
  assert.match(migration, /matching_claims <> 2/);
});

test("claim service binds actor, current version, repeated board, and two-party finish order", () => {
  const start = service.indexOf("export async function claimJapaneseWholeBoardRepetition");
  const end = service.indexOf("export async function resignJapaneseGame", start);
  const claim = service.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(claim.includes("assertExpectedVersion"));
  assert.ok(claim.includes("currentJapaneseWholeBoardRepetition"));
  assert.ok(claim.includes("playerColor"));
  assert.ok(claim.includes("INSERT INTO game_japanese_repetition_claims"));
  assert.ok(claim.includes("finish_reason='japanese_repetition'"));
  assert.ok(
    claim.indexOf("INSERT INTO game_japanese_repetition_claims")
      < claim.indexOf("finish_reason='japanese_repetition'"),
  );
  assert.ok(route.includes("assertExpectedPlayer"));
  assert.ok(route.includes("MAX_PERSISTED_GAME_VERSION"));
});

test("production preflight requires repetition constraints, triggers, RLS, and guards", () => {
  for (const fragment of [
    "game_japanese_repetition_claims",
    "game_japanese_repetition_claim_insert_guard",
    "game_japanese_repetition_claim_commit_guard",
    "game_japanese_repetition_claim_immutable_guard",
    "game_japanese_repetition_claim_truncate_guard",
    "game_japanese_repetition_finish_guard",
    "public.validate_japanese_repetition_claim_insert()",
    "public.guard_japanese_repetition_claim_mutation()",
  ]) assert.ok(preflight.includes(fragment), `preflight missing ${fragment}`);
});
