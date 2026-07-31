import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(join(process.cwd(), "db/migrations/028_calibrated_bot_rating_evidence.sql"), "utf8");
const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
const preflight = readFileSync(join(process.cwd(), "scripts/check-mvp.ts"), "utf8");

test("bootstrap schema ends with the exact calibrated-bot evidence migration", () => {
  assert.equal(schema.slice(-migration.length), migration);
});

test("rated bot credit never uses mutable heuristic target rating", () => {
  for (const table of [
    "calibrated_bot_profiles", "calibrated_bot_profile_configurations",
    "calibrated_bot_profile_activation_events", "game_calibrated_bot_bindings",
    "game_calibrated_bot_actions",
  ]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /rating_mode IN \('unrated','calibrated-v1'\)/);
  assert.doesNotMatch(migration, /target_rating[^\n]*(?:opponent_rating|fixed_rating)/);
  assert.doesNotMatch(migration, /INSERT INTO calibrated_bot_profiles/);
  assert.doesNotMatch(migration, /INSERT INTO calibrated_bot_profile_activation_events/);
});

test("human-bot evidence has one human transition and exact execution identity", () => {
  assert.match(migration, /event_count <> 1/);
  assert.match(migration, /action\.engine_version = binding_row\.engine_version/);
  assert.match(migration, /opponent_profile_fingerprint/);
  assert.match(migration, /Global rating state changes require matching immutable game evidence/);
  assert.match(migration, /BEFORE UPDATE ON player_glicko2_ratings/);
  assert.match(migration, /calibrated_bot_action_insert_guard/);
  assert.match(migration, /bound_game_bot_identity_guard/);
  assert.match(preflight, /idx_calibrated_bot_action_move_once/);
  assert.match(preflight, /validate_calibrated_bot_action_insert/);
  assert.match(migration, /No profile or activation is seeded/);
});
