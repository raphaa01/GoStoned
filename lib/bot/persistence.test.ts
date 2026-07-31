import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../db/migrations/018_katago_bot_games.sql", import.meta.url), "utf8");
const matchmaking = readFileSync(new URL("../matchmaking/matchmakingService.ts", import.meta.url), "utf8");

test("bot games require a fresh worker and retain explicit bot identity", () => {
  for (const source of [schema, migration]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS katago_workers/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS game_bots/);
    assert.match(source, /bot_player_key TEXT UNIQUE NOT NULL CHECK \(bot_player_key LIKE 'bot:%'\)/);
    assert.match(source, /target_rating INT NOT NULL/);
    assert.match(source, /ALTER TABLE game_bots ENABLE ROW LEVEL SECURITY/);
  }
  assert.match(matchmaking, /INTERVAL '10 seconds' AS bot_fallback_due/);
  assert.match(matchmaking, /last_seen_at >= NOW\(\) - INTERVAL '15 seconds'/);
  assert.match(matchmaking, /status = 'matched', game_id = \$1/);
  assert.ok(
    schema.replaceAll("\r\n", "\n").includes(migration.replaceAll("\r\n", "\n").trim()),
    "Canonical schema must contain migration 018 before later migrations.",
  );
});
