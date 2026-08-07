import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(process.cwd(), "db/migrations/032_provider_neutral_japanese_rules.sql"),
  "utf8",
);
const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
const service = readFileSync(join(process.cwd(), "lib/game/japaneseGameService.ts"), "utf8");

test("fresh schema ends with the byte-identical Japanese activation migration", () => {
  assert.equal(schema.endsWith(migration), true);
});

test("activation keeps historical tuples and enables the exact Japanese tuple", () => {
  for (const required of [
    "'legacy-immediate-area'",
    "'chinese-2002-gostone-v1'",
    "'japanese-1989-gostone-v1'",
    "rules IN ('chinese','japanese')",
    "scoring_method IN ('area','territory')",
    "matchmaking_queue_adaptive_state_check",
    "rules_snapshot = 'japanese'",
    "rules_version_snapshot = 'japanese-1989-gostone-v1'",
    "scoring_method_snapshot = 'territory'",
  ]) assert.ok(migration.includes(required), required);
});

test("manual, model, deadline, resume, and repetition evidence is protected", () => {
  for (const required of [
    "game_japanese_resume_authorizations",
    "game_japanese_scoring_proposals",
    "game_japanese_scoring_terminal_events",
    "game_japanese_repetition_claims",
    "manual_initial",
    "model_initial",
    "ENABLE ROW LEVEL SECURITY",
    "REVOKE ALL",
    "append-only",
  ]) assert.ok(migration.includes(required), required);
});

test("Japanese scoring has no KataGo dependency or adjudication finish path", () => {
  assert.doesNotMatch(service, /katago/i);
  assert.doesNotMatch(migration, /katago|japanese_adjudication/i);
  assert.match(service, /source: "manual_initial"/);
  assert.match(service, /decideJapaneseScoringDeadline/);
});

test("Japanese full reads and version polls resolve elapsed clocks transactionally", () => {
  const fullRead = service.slice(
    service.indexOf("export async function getJapaneseGameState"),
    service.indexOf("export async function pollJapaneseGameState"),
  );
  const poll = service.slice(
    service.indexOf("export async function pollJapaneseGameState"),
    service.indexOf("export async function submitJapaneseMove"),
  );
  const timeout = service.slice(
    service.indexOf("async function finishJapaneseOnTime"),
    service.indexOf("function serializeJapaneseGame"),
  );

  assert.match(fullRead, /withTransaction/);
  assert.match(fullRead, /loadJapaneseGame\(client, gameId, playerKey, true\)/);
  assert.match(fullRead, /finishJapaneseOnTime/);
  assert.match(poll, /japaneseTimedOutColor/);
  assert.match(poll, /getJapaneseGameState/);
  assert.match(timeout, /finish_reason='timeout'/);
  assert.match(timeout, /_time_remaining_ms=0/);
  assert.match(timeout, /_periods_remaining=0/);
  assert.match(timeout, /finalizeGameRatings/);
});
