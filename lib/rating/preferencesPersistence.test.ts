import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(join(process.cwd(), "db/migrations/027_rating_preferences_and_match_pools.sql"), "utf8");
const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
const preflight = readFileSync(join(process.cwd(), "scripts/check-mvp.ts"), "utf8");

test("bootstrap schema contains the exact preferences and adaptive-pool migration", () => {
  const offset = schema.indexOf(migration);
  assert.ok(offset >= 0);
  assert.equal(schema.slice(offset, offset + migration.length), migration);
});

test("starting strength is one-time evidence and existing accounts are not opted into bots", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS player_initial_rating_claims/);
  assert.match(migration, /Initial rating claims are append-only/);
  assert.match(migration, /rated_game_count <> 0/);
  assert.match(migration, /bot_match_preference TEXT NOT NULL DEFAULT 'never'/);
  assert.match(migration, /player_rating_preferences_update_guard/);
  assert.match(migration, /preference_revision <> OLD\.preference_revision \+ 1/);
  assert.doesNotMatch(migration, /DEFAULT TRUE|bot_fallback_enabled/);
});

test("adaptive queue snapshots identity, rules, rating provenance, and preferences", () => {
  for (const fragment of [
    "adaptive-global-glicko-match-v1", "match_pool", "rules_version_snapshot",
    "rating_algorithm_version", "rating_state_updated_at", "preference_revision",
    "display_preference_snapshot",
    "abandonment_policy_version", "bot_fallback_not_before",
  ]) assert.match(migration, new RegExp(fragment));
  assert.match(migration, /match_pool = 'guest-unrated'[\s\S]*player_key LIKE 'guest:%'/);
  assert.match(migration, /match_pool = 'registered-rated'[\s\S]*player_key LIKE 'user:%'/);
  assert.match(preflight, /idx_matchmaking_adaptive_waiting/);
  assert.match(preflight, /player_initial_rating_claims/);
});
