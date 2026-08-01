import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("db/migrations/026_katago_scoring_jobs.sql");
const schema = read("db/schema.sql");
const preflight = read("scripts/check-mvp.ts");
const worker = read("workers/katago/scoring.ts");
const botWorker = read("workers/katago/bot.ts");

test("fresh and upgraded schemas expose one immutable durable scoring queue", () => {
  for (const source of [migration, schema]) {
    for (const fragment of [
      "CREATE TABLE IF NOT EXISTS katago_scoring_jobs",
      "katago_scoring_jobs_request_shape_check",
      "validate_katago_scoring_job_insert",
      "guard_katago_scoring_job_mutation",
      "ENABLE ROW LEVEL SECURITY",
      "REVOKE ALL ON katago_scoring_jobs FROM PUBLIC",
    ]) assert.ok(source.includes(fragment), `missing ${fragment}`);
  }
  assert.doesNotMatch(migration, /^\s*(?:BEGIN|COMMIT)\s*;/m);
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
  assert.match(preflight, /idx_katago_scoring_jobs_claim/);
  assert.match(preflight, /public\.validate_katago_scoring_job_insert\(\)/);
});

test("worker requests bounded ownership and returns exact engine identity", () => {
  assert.match(worker, /includeOwnership: true/);
  assert.match(worker, /request\.engine\.engineVersion !== identity\.engineVersion/);
  assert.match(worker, /KATAGO_OPPONENT_OWNERSHIP_THRESHOLD/);
  assert.match(worker, /status='completed'/);
});

test("bot claims and confirms both Japanese and legacy scoring boundaries", () => {
  assert.match(botWorker, /LEFT JOIN game_japanese_scoring_state japanese_scoring/);
  assert.match(botWorker, /game\.rules_profile = 'japanese-1989-gostone-v1'/);
  assert.match(botWorker, /japanese_scoring\.black_confirmed_revision/);
  assert.match(botWorker, /await confirmScore\(/);
});
