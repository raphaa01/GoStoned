import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "db/migrations/011_game_scoring_resume_evidence.sql"),
  "utf8",
);
const productionPreflight = readFileSync(
  join(process.cwd(), "scripts/check-mvp.ts"),
  "utf8",
);
const gameService = readFileSync(
  join(process.cwd(), "lib/game/gameService.ts"),
  "utf8",
);

function tableDefinition(sql: string): string {
  const start = sql.indexOf("CREATE TABLE IF NOT EXISTS game_scoring_resume_events (");
  assert.notEqual(start, -1, "resume evidence table must be created");
  const end = sql.indexOf("\n);", start);
  assert.notEqual(end, -1, "resume evidence table must terminate");
  return sql.slice(start, end + 3);
}

function functionDefinition(sql: string): string {
  const marker = "CREATE OR REPLACE FUNCTION public.guard_game_scoring_resume_event_mutation()";
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, "resume evidence mutation guard must be created");
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, "resume evidence mutation guard must terminate");
  return sql.slice(start, end + 4);
}

function insertValidatorDefinition(sql: string): string {
  const marker = "CREATE OR REPLACE FUNCTION public.validate_game_scoring_resume_event_insert()";
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, "resume evidence insert validator must be created");
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, "resume evidence insert validator must terminate");
  return sql.slice(start, end + 4);
}

function commitValidatorDefinition(sql: string): string {
  const marker = "CREATE OR REPLACE FUNCTION public.validate_game_scoring_resume_event_commit()";
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, "resume evidence commit validator must be created");
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, "resume evidence commit validator must terminate");
  return sql.slice(start, end + 4);
}

test("fresh and upgraded databases share one bounded Chinese resume evidence contract", () => {
  assert.equal(tableDefinition(schema), tableDefinition(migration));
  const table = tableDefinition(migration);
  for (const required of [
    "PRIMARY KEY (game_id, scoring_revision)",
    "board_hash TEXT NOT NULL",
    "stopped_move_number INT NOT NULL",
    "rules = 'chinese'",
    "rules_profile = 'chinese-2002-gostone-v1'",
    "scoring_method = 'area'",
    "fallback_to_move",
    "scoring_expires_at",
    "resume_claim",
    "requested_by_color",
    "disputed_x",
    "disputed_y",
    "resumed_to_move",
    "resumed_at",
  ]) {
    assert.ok(table.includes(required), `resume evidence must contain ${required}`);
  }
  assert.equal(table.includes("japanese"), false);
  assert.ok(table.includes("resume_claim = 'deadline'"));
  assert.ok(table.includes("resumed_at < scoring_expires_at"));
  assert.ok(table.includes("scoring_expires_at <= resumed_at"));
  assert.ok(table.includes("resumed_to_move = fallback_to_move"));
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+game_scoring_resume_events/i);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|CONSTRAINT)/i);
});

test("resume evidence is append-only and isolated from client database roles", () => {
  assert.equal(functionDefinition(schema), functionDefinition(migration));
  assert.equal(insertValidatorDefinition(schema), insertValidatorDefinition(migration));
  assert.equal(commitValidatorDefinition(schema), commitValidatorDefinition(migration));
  for (const sql of [schema, migration]) {
    assert.ok(sql.includes("game_scoring_resume_events_insert_guard"));
    assert.ok(sql.includes("BEFORE INSERT ON public.game_scoring_resume_events"));
    assert.ok(sql.includes("game_scoring_resume_events_commit_guard"));
    assert.ok(
      sql.includes(
        "AFTER INSERT ON public.game_scoring_resume_events\n      DEFERRABLE INITIALLY DEFERRED",
      ),
    );
    assert.ok(sql.includes("game_scoring_resume_events_immutable_guard"));
    assert.ok(sql.includes("BEFORE UPDATE OR DELETE ON public.game_scoring_resume_events"));
    assert.ok(sql.includes("game_scoring_resume_events_truncate_guard"));
    assert.ok(sql.includes("BEFORE TRUNCATE ON public.game_scoring_resume_events"));
    assert.ok(sql.includes("Game scoring resume evidence is append-only."));
    assert.ok(sql.includes("ALTER TABLE game_scoring_resume_events ENABLE ROW LEVEL SECURITY"));
    assert.ok(sql.includes("REVOKE ALL ON game_scoring_resume_events FROM PUBLIC"));
    assert.match(sql, /REVOKE ALL ON[\s\S]*game_scoring_resume_events[\s\S]*FROM anon;/);
    assert.match(sql, /REVOKE ALL ON[\s\S]*game_scoring_resume_events[\s\S]*FROM authenticated;/);
    assert.ok(
      sql.includes(
        "REVOKE ALL ON FUNCTION public.guard_game_scoring_resume_event_mutation() FROM PUBLIC",
      ),
    );
    assert.ok(
      sql.includes(
        "REVOKE ALL ON FUNCTION public.validate_game_scoring_resume_event_insert() FROM PUBLIC",
      ),
    );
    assert.ok(
      sql.includes(
        "REVOKE ALL ON FUNCTION public.validate_game_scoring_resume_event_commit() FROM PUBLIC",
      ),
    );
  }
});

test("insert validation binds evidence to the live snapshot and real board", () => {
  const validator = insertValidatorDefinition(migration);
  for (const required of [
    "JOIN public.game_scoring_state AS scoring",
    "FOR SHARE OF game, scoring",
    "snapshot.status <> 'active'",
    "snapshot.phase <> 'scoring'",
    "snapshot.game_scoring_revision",
    "snapshot.snapshot_revision",
    "snapshot.board_hash",
    "snapshot.stopped_move_number",
    "snapshot.fallback_to_move",
    "snapshot.expires_at",
    "NEW.disputed_x >= snapshot.board_size",
    "FROM public.game_dead_stones AS dead_stone",
  ]) {
    assert.ok(validator.includes(required), `insert validator must contain ${required}`);
  }
});

test("deferred validation requires the matching scoring-to-play transition", () => {
  const validator = commitValidatorDefinition(migration);
  for (const required of [
    "lifecycle.status = 'active'",
    "lifecycle.phase = 'play'",
    "lifecycle.to_move IS NOT DISTINCT FROM NEW.resumed_to_move",
    "lifecycle.status = 'finished'",
    "lifecycle.finish_reason IN ('resignation', 'timeout')",
    "lifecycle.scoring_revision IS DISTINCT FROM NEW.scoring_revision + 1",
    "lifecycle.last_resume_claim IS DISTINCT FROM NEW.resume_claim",
    "lifecycle.last_resume_by IS DISTINCT FROM NEW.requested_by_color",
    "lifecycle.last_resume_x IS DISTINCT FROM NEW.disputed_x",
    "lifecycle.last_resume_y IS DISTINCT FROM NEW.disputed_y",
    "lifecycle.has_scoring_state",
  ]) {
    assert.ok(validator.includes(required), `commit validator must contain ${required}`);
  }
});

test("resume evidence remains bound to the exact game rules tuple", () => {
  for (const sql of [schema, migration]) {
    assert.ok(sql.includes("game_scoring_resume_events_game_rules_fk"));
    assert.ok(
      sql.includes(
        "FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)",
      ),
    );
    assert.ok(
      sql.includes(
        "REFERENCES games (id, rules, rules_profile, scoring_method, komi, handicap)",
      ),
    );
    assert.ok(sql.includes("ON DELETE CASCADE"));
  }
});

test("production preflight requires the complete resume evidence boundary", () => {
  for (const required of [
    "game_scoring_resume_events",
    "resume_event_columns",
    "game_scoring_resume_events_pkey",
    "game_scoring_resume_events_claim_shape_check",
    "game_scoring_resume_events_game_rules_fk",
    "game_scoring_resume_events_insert_guard",
    "game_scoring_resume_events_commit_guard",
    "game_scoring_resume_events_immutable_guard",
    "game_scoring_resume_events_truncate_guard",
    "validate_game_scoring_resume_event_insert",
    "validate_game_scoring_resume_event_commit",
    "guard_game_scoring_resume_event_mutation",
    "guard_function_definitions",
    "pg_get_functiondef",
  ]) {
    assert.ok(productionPreflight.includes(required), `preflight must require ${required}`);
  }
});

test("participant game service reads ordered evidence and appends before deleting scoring state", () => {
  const insertion = gameService.indexOf("INSERT INTO game_scoring_resume_events");
  const deadlineResume = gameService.indexOf("async function resumeExpiredScoring");
  const manualResume = gameService.indexOf("export async function resumePlay");
  assert.ok(insertion >= 0 && insertion < deadlineResume);
  for (const start of [deadlineResume, manualResume]) {
    const nextDelete = gameService.indexOf("DELETE FROM game_scoring_state", start);
    const nextAppend = gameService.indexOf("appendScoringResumeEvidence", start);
    assert.ok(nextAppend > start);
    assert.ok(nextDelete > nextAppend);
  }
  const manualResumeSource = gameService.slice(manualResume);
  const manualResumeBody = manualResumeSource.slice(0, manualResumeSource.indexOf("export async function resignGame"));
  assert.equal(manualResumeBody.match(/new Date\(\)/g)?.length, 1);
  assert.ok(manualResumeBody.includes("resumeExpiredScoring(client, loaded, decisionAt)"));
  assert.ok(manualResumeBody.includes("resumedAt: decisionAt"));
  assert.equal(
    gameService.slice(manualResume).includes("game_japanese_scoring_state"),
    false,
  );
  assert.equal(gameService.match(/INSERT INTO game_scoring_resume_events/g)?.length, 1);
  assert.equal(gameService.match(/FROM game_scoring_resume_events/g)?.length, 1);
  const loadGame = gameService.indexOf("async function loadGame");
  const participantCheck = gameService.indexOf("assertParticipant(game, playerKey)", loadGame);
  const evidenceRead = gameService.indexOf("FROM game_scoring_resume_events", loadGame);
  const replay = gameService.indexOf("replayStoredMoveRows(", evidenceRead);
  const cacheAssertion = gameService.indexOf("assertCurrentProfileTurnCache", replay);
  assert.ok(loadGame >= 0);
  assert.ok(participantCheck > loadGame);
  assert.ok(evidenceRead > participantCheck);
  assert.ok(replay > evidenceRead);
  assert.ok(cacheAssertion > replay);
  assert.ok(gameService.slice(evidenceRead - 600, evidenceRead + 600).includes("ORDER BY scoring_revision"));
  assert.ok(gameService.slice(evidenceRead - 600, evidenceRead + 600).includes("LIMIT $2"));
});
