import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrationPath = join(process.cwd(), "db/migrations/023_global_glicko2_persistence.sql");
const migration = readFileSync(migrationPath, "utf8");
const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
const preflight = readFileSync(join(process.cwd(), "scripts/check-mvp.ts"), "utf8");

test("bootstrap schema contains the exact numbered global-rating migration", () => {
  const normalizedSchema = schema.replaceAll("\r\n", "\n");
  const normalizedMigration = migration.replaceAll("\r\n", "\n");
  const offset = normalizedSchema.indexOf(normalizedMigration);
  assert.ok(offset >= 0);
  assert.equal(
    normalizedSchema.slice(offset, offset + normalizedMigration.length),
    normalizedMigration,
  );
});

test("legacy multi-board state selects one deterministic latest row without rewriting history", () => {
  const multiBoardFixture = [
    { boardSize: 19, rating: 1700, games: 40, updatedAt: 1 },
    { boardSize: 13, rating: 1450, games: 12, updatedAt: 2 },
    { boardSize: 9, rating: 1510, games: 12, updatedAt: 2 },
  ];
  const selected = [...multiBoardFixture].sort((left, right) =>
    right.updatedAt - left.updatedAt
    || right.games - left.games
    || left.boardSize - right.boardSize
  )[0];
  assert.deepEqual(selected, multiBoardFixture[2]);
  assert.match(migration, /ORDER BY stats\.updated_at DESC NULLS LAST,\s+stats\.games DESC,\s+stats\.board_size ASC\s+LIMIT 1/);
  assert.match(migration, /rating_algorithm_version = 'fixed-elo-legacy-v1'/);
  assert.doesNotMatch(migration, /AVG\(stats\.rating\)|MAX\(stats\.rating\)/);
  assert.doesNotMatch(migration, /UPDATE player_stats/);
  assert.doesNotMatch(migration, /UPDATE games\s+SET result|UPDATE games\s+SET winner_key/);
});

test("global state and paired evidence retain the complete versioned Glicko-2 transition", () => {
  for (const fragment of [
    "player_glicko2_ratings",
    "game_glicko2_rating_events",
    "rating_deviation_before",
    "rating_deviation_after",
    "volatility_before",
    "volatility_after",
    "last_rating_period_at_before",
    "last_rating_period_at_after",
    "glicko2-v1-tau-0.5",
    "event_count <> 2",
    "complete paired state transition",
  ]) assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(migration, /BEFORE UPDATE OR DELETE ON game_glicko2_rating_events/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT,INSERT,UPDATE ON player_glicko2_ratings TO gostone_app/);
  assert.match(migration, /CREATE POLICY gostone_app_server_insert ON game_glicko2_rating_events/);
});

test("opponent boundaries are explicit and fail closed", () => {
  assert.match(migration, /outcome_kind = 'no_result'[\s\S]*rating_after = rating_before/);
  assert.match(migration, /finish_reason IN \('score', 'legacy_score'\) THEN 'draw'/);
  assert.match(migration, /opponent_kind IN \('registered_human', 'calibrated_bot'\)/);
  assert.match(migration, /NEW\.opponent_kind <> 'registered_human'/);
  assert.match(migration, /opponent_profile_version/);
});

test("production preflight covers the new catalog, guards, index, RLS, and grants", () => {
  for (const fragment of [
    "player_glicko2_ratings",
    "game_glicko2_rating_events",
    "rating_algorithm_version",
    "idx_game_glicko2_events_player_period",
    "game_glicko2_rating_events_commit_guard",
    "validate_glicko2_rating_event_insert",
    "validate_glicko2_rating_event_commit",
    "guard_glicko2_rating_event_mutation",
  ]) assert.match(preflight, new RegExp(fragment));
});
