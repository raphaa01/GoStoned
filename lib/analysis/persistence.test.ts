import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../db/migrations/017_game_analysis_jobs.sql", import.meta.url), "utf8");

test("analysis jobs are persistent, leaseable, private, and version-bound", () => {
  for (const source of [schema, migration]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS game_analysis_jobs/);
    assert.match(source, /UNIQUE \(game_id, game_version\)/);
    assert.match(source, /status IN \('queued', 'running', 'completed', 'failed'\)/);
    assert.match(source, /lease_expires_at TIMESTAMPTZ/);
    assert.match(source, /ALTER TABLE game_analysis_jobs ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /REVOKE ALL ON game_analysis_jobs FROM PUBLIC/);
  }
  assert.ok(
    schema.replaceAll("\r\n", "\n").endsWith(migration.replaceAll("\r\n", "\n")),
    "Canonical schema must end with migration 017.",
  );
});
