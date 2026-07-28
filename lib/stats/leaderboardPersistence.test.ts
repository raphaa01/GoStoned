import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../db/migrations/012_leaderboard_rating_history_index.sql", import.meta.url),
  "utf8",
);
const productionPreflight = readFileSync(
  new URL("../../scripts/check-mvp.ts", import.meta.url),
  "utf8",
);

test("fresh and upgraded databases share the leaderboard history access path", () => {
  const required = [
    "idx_player_rating_history_board_player_time",
    "ON player_rating_history(board_size, player_key, recorded_at, id)",
    "INCLUDE (game_id, rating_before, rating_after, result)",
  ];
  for (const fragment of required) {
    assert.ok(schema.includes(fragment), `fresh schema must include ${fragment}`);
    assert.ok(migration.includes(fragment), `migration must include ${fragment}`);
  }
  assert.equal(
    (schema.match(/idx_player_rating_history_board_player_time/g) ?? []).length,
    1,
  );
  assert.match(migration, /^-- gostone:migration-mode=nontransactional\n/);
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
});

test("production preflight requires the leaderboard history index definition", () => {
  for (const fragment of [
    "idx_player_rating_history_board_player_time",
    "ON public.player_rating_history USING btree (board_size, player_key, recorded_at, id)",
    "INCLUDE (game_id, rating_before, rating_after, result)",
    "indisready",
    "indisvalid",
    "Database index is incomplete",
  ]) {
    assert.ok(productionPreflight.includes(fragment), `preflight must require ${fragment}`);
  }
});

test("migration runner keeps concurrent index builds outside its transaction", () => {
  const migrationRunner = readFileSync(
    new URL("../../scripts/migrate.ts", import.meta.url),
    "utf8",
  );
  const migrationContracts = readFileSync(
    new URL("../../scripts/migrationIndexes.ts", import.meta.url),
    "utf8",
  );
  assert.match(migrationContracts, /gostone:migration-mode=nontransactional/);
  assert.match(migrationRunner, /pg_try_advisory_lock/);
  assert.match(migrationRunner, /public\.schema_migrations/);
  assert.match(
    migrationRunner,
    /if \(migration\.nonTransactional\) \{\s+await reconcileConcurrentIndex/,
  );
  assert.match(
    migrationRunner,
    /continue;\s+\}\s+\n\s+if \(alreadyApplied\.rowCount\)/,
  );
  assert.match(
    migrationRunner,
    /classification\.state === "exact-invalid"[\s\S]+BEGIN[\s\S]+recoveryLockSql[\s\S]+recoveryRenameSql[\s\S]+relationOid !== confirmed\.relationOid[\s\S]+recoveryDropSql[\s\S]+COMMIT/,
  );
});
