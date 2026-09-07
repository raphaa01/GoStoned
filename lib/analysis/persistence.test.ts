import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../db/migrations/017_game_analysis_jobs.sql", import.meta.url), "utf8");
const quotaMigration = readFileSync(new URL("../../db/migrations/035_analysis_weekly_quota.sql", import.meta.url), "utf8");
const analysisService = readFileSync(new URL("./analysisService.ts", import.meta.url), "utf8");

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
    schema.replaceAll("\r\n", "\n").includes(migration.replaceAll("\r\n", "\n").trim()),
    "Canonical schema must contain migration 017 before later migrations.",
  );
});

test("analysis quota is account-bound and premium-ready", () => {
  for (const source of [schema, quotaMigration]) {
    assert.match(source, /analysis_unlimited BOOLEAN NOT NULL DEFAULT false/);
    assert.match(source, /requested_by_user_id UUID REFERENCES users\(id\) ON DELETE SET NULL/);
    assert.match(source, /idx_game_analysis_jobs_requester/);
  }
  assert.ok(
    schema.replaceAll("\r\n", "\n").includes(quotaMigration.replaceAll("\r\n", "\n").trim()),
    "Canonical schema must contain migration 035.",
  );
  assert.match(analysisService, /SELECT COALESCE\([\s\S]+FOR UPDATE/);
  assert.match(analysisService, /to_jsonb\(users\)[\s\S]+analysis_unlimited/);
  assert.match(analysisService, /requested_by_key = \$1[\s\S]+INTERVAL '7 days'/);
  assert.match(analysisService, /existing && existing\.status !== "failed"/);
});
