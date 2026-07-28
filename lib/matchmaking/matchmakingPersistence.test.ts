import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../db/migrations/015_matchmaking_stale_cleanup_index.sql", import.meta.url),
  "utf8",
);
const productionPreflight = readFileSync(
  new URL("../../scripts/check-mvp.ts", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./matchmakingService.ts", import.meta.url), "utf8");

test("fresh and upgraded databases share the stale matchmaking cleanup access path", () => {
  const required = [
    "idx_matchmaking_waiting_pool_updated_at",
    "ON matchmaking_queue(board_size, time_control, rules_profile, updated_at, player_key)",
    "WHERE status = 'waiting'",
  ];
  for (const fragment of required) {
    assert.ok(schema.includes(fragment), `fresh schema must include ${fragment}`);
    assert.ok(migration.includes(fragment), `migration must include ${fragment}`);
  }
  assert.equal(
    (schema.match(/idx_matchmaking_waiting_pool_updated_at/g) ?? []).length,
    1,
  );
  assert.match(migration, /^-- gostone:migration-mode=nontransactional\n/);
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.doesNotMatch(migration, /DROP INDEX/);
});

test("production preflight requires the exact ready and valid cleanup index", () => {
  assert.match(
    productionPreflight,
    /idx_matchmaking_waiting_pool_updated_at:\s*\[\s*"ON public\.matchmaking_queue USING btree \(board_size, time_control, rules_profile, updated_at, player_key\)",\s*"WHERE \(status = 'waiting'::text\)",?\s*\]/,
  );
  for (const fragment of [
    "indisready",
    "indisvalid",
    "Database index is incomplete",
  ]) {
    assert.ok(productionPreflight.includes(fragment), `preflight must require ${fragment}`);
  }
});

test("bounded cleanup and the exact stale/fresh threshold partition remain one contract", () => {
  for (const fragment of [
    "WITH stale_waiting AS MATERIALIZED",
    "queued.updated_at < NOW() - INTERVAL '5 minutes'",
    "ORDER BY queued.updated_at, queued.player_key",
    "LIMIT 200",
    "FOR UPDATE OF queued SKIP LOCKED",
    "USING stale_waiting AS stale",
    "WHERE queued.player_key = stale.player_key",
    "q.updated_at >= NOW() - INTERVAL '5 minutes'",
  ]) {
    assert.ok(service.includes(fragment), `matchmaking service must include ${fragment}`);
  }
  assert.doesNotMatch(
    service,
    /DELETE FROM matchmaking_queue\s+WHERE board_size[^;]+updated_at < NOW\(\)/,
  );
  assert.match(
    service.replace(/\s+/g, " "),
    /DELETE FROM matchmaking_queue AS queued USING stale_waiting AS stale WHERE queued\.player_key = stale\.player_key AND queued\.board_size = \$1 AND queued\.time_control = \$2 AND queued\.rules_profile = \$3 AND queued\.status = 'waiting' AND queued\.updated_at < NOW\(\) - INTERVAL '5 minutes'/,
  );
});
