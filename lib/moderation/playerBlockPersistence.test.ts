import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();

async function source(path: string) {
  return readFile(`${root}/${path}`, "utf8");
}

function assertBlockTableContract(sql: string) {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS player_blocks/);
  assert.match(sql, /CONSTRAINT player_blocks_pkey PRIMARY KEY \(blocker_key, blocked_key\)/);
  assert.match(sql, /CONSTRAINT player_blocks_distinct_players_check CHECK \(blocker_key <> blocked_key\)/);
  assert.match(sql, /CONSTRAINT player_blocks_key_bounds_check CHECK/);
  assert.match(sql, /\^\(user\|guest\):\[0-9a-f\]/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_player_blocks_blocked_blocker\s+ON player_blocks\(blocked_key, blocker_key\)/);
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_player_blocks_guest_retention\s+ON player_blocks\(created_at, blocker_key, blocked_key\)\s+WHERE blocker_key LIKE 'guest:%' OR blocked_key LIKE 'guest:%'/,
  );
  assert.match(sql, /ALTER TABLE player_blocks ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON [^;]*player_blocks[^;]* FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON [^;]*player_blocks[^;]* FROM anon/);
  assert.match(sql, /REVOKE ALL ON [^;]*player_blocks[^;]* FROM authenticated/);
}

test("bootstrap and numbered migration share the protected directional block contract", async () => {
  const [schema, migration] = await Promise.all([
    source("db/schema.sql"),
    source("db/migrations/013_player_blocks.sql"),
  ]);
  assertBlockTableContract(schema);
  assertBlockTableContract(migration);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test("production preflight verifies block table, constraints, index readiness, RLS, and grants", async () => {
  const preflight = await source("scripts/check-mvp.ts");
  assert.match(preflight, /requiredTables[\s\S]*"player_blocks"/);
  assert.match(preflight, /idx_player_blocks_blocked_blocker/);
  assert.match(preflight, /idx_player_blocks_guest_retention/);
  assert.match(preflight, /player_blocks_pkey:player_blocks:p/);
  assert.match(preflight, /player_blocks_distinct_players_check:player_blocks:c/);
  assert.match(preflight, /player_blocks_key_bounds_check:player_blocks:c/);
  assert.match(preflight, /requiredProtectedTables[\s\S]*"player_blocks"/);
  assert.match(preflight, /!state\?\.isReady[\s\S]*!state\.isValid/);
  assert.match(preflight, /public_has_table_access/);
  assert.match(preflight, /client_roles_have_table_access/);
});

test("block storage contains no game, display-name, reason, or message metadata", async () => {
  const migration = await source("db/migrations/013_player_blocks.sql");
  const table = migration.match(/CREATE TABLE IF NOT EXISTS player_blocks \(([\s\S]*?)\n\);/)?.[1];
  assert.ok(table);
  assert.doesNotMatch(table, /game_id|display_name|username|reason|message/i);
});

test("guest expiry and guest block retention cleanup are independently bounded and indexed", async () => {
  const guestSessions = await source("lib/auth/guestSession.ts");
  assert.match(guestSessions, /expired_guests AS MATERIALIZED/);
  assert.match(guestSessions, /WHERE expires_at <= NOW\(\)/);
  assert.match(guestSessions, /LIMIT 200\s+FOR UPDATE SKIP LOCKED/);
  assert.match(
    guestSessions,
    /DELETE FROM guest_sessions AS guest_session[\s\S]+guest_session\.guest_id = expired\.guest_id/,
  );
  assert.match(guestSessions, /expired_guest_blocks AS MATERIALIZED/);
  assert.match(guestSessions, /FROM player_blocks AS player_block/);
  assert.match(guestSessions, /player_block\.created_at < NOW\(\) - INTERVAL '30 days'/);
  assert.match(guestSessions, /player_block\.blocker_key LIKE 'guest:%'[\s\S]+player_block\.blocked_key LIKE 'guest:%'/);
  assert.doesNotMatch(guestSessions, /NOT EXISTS|split_part/);
  assert.match(
    guestSessions,
    /ORDER BY player_block\.created_at,[\s\S]+LIMIT 200\s+FOR UPDATE OF player_block SKIP LOCKED/,
  );
  assert.match(
    guestSessions,
    /DELETE FROM player_blocks AS player_block[\s\S]+player_block\.ctid = expired\.ctid/,
  );
});
