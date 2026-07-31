import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "db/migrations/024_japanese_scoring_activation.sql"),
  "utf8",
);
const preflight = readFileSync(join(process.cwd(), "scripts/check-mvp.ts"), "utf8");
const gameService = readFileSync(join(process.cwd(), "lib/game/gameService.ts"), "utf8");

function functionDefinition(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name} must terminate`);
  return sql.slice(start, end + 4);
}

function tableDefinition(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = sql.indexOf("\n);", start);
  assert.notEqual(end, -1, `${name} must terminate`);
  return sql.slice(start, end + 3);
}

test("schema embeds migration 024 and widens only supported rules identities", () => {
  assert.ok(schema.includes(migration));
  for (const required of [
    "games_rules_profile_check",
    "'legacy-immediate-area'",
    "'chinese-2002-gostone-v1'",
    "'japanese-1989-gostone-v1'",
    "CHECK (scoring_method IN ('area', 'territory'))",
    "CHECK (rules IN ('chinese', 'japanese'))",
    "matchmaking_queue_rules_profile_compatibility_check",
  ]) {
    assert.ok(migration.includes(required), `activation must include ${required}`);
  }
  assert.ok(migration.includes("SET LOCAL lock_timeout = '5s'"));
  assert.ok(migration.includes("DROP CONSTRAINT IF EXISTS games_rules_check"));
  assert.equal(gameService.includes("game_japanese_scoring_proposals"), false);
  assert.equal(gameService.includes("game_japanese_scoring_terminal_events"), false);
});

test("state stores an application deadline, monotonic participation, and bounded diagnostics", () => {
  for (const column of [
    "expires_at",
    "black_participated_at",
    "white_participated_at",
    "suggestion_status",
    "suggestion_request_identity",
    "suggestion_provider_kind",
    "suggestion_engine_version",
    "suggestion_model_version",
    "suggestion_config_version",
    "suggestion_confidence_policy_version",
    "suggestion_latency_ms",
  ]) {
    assert.ok(migration.includes(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.ok(migration.includes("ALTER COLUMN expires_at SET NOT NULL"));
  assert.ok(migration.includes("expires_at >= started_at + INTERVAL '30 seconds'"));
  assert.ok(migration.includes("expires_at <= started_at + INTERVAL '1 hour'"));
  assert.equal(/expires_at TIMESTAMPTZ DEFAULT/.test(migration), false);
  for (const status of ["pending", "ready", "unavailable", "invalid", "low_confidence"]) {
    assert.ok(migration.includes(`'${status}'`));
  }
});

test("proposal history uses the server scoring revision and retains no provider payload", () => {
  const table = tableDefinition(migration, "game_japanese_scoring_proposals");
  for (const required of [
    "PRIMARY KEY (game_id, scoring_revision)",
    "parent_scoring_revision INT",
    "source IN ('katago_initial', 'player_edit', 'undo', 'reset')",
    "dead_stones JSONB NOT NULL",
    "neutral_region_seeds JSONB NOT NULL",
    "FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)",
    "ON DELETE CASCADE",
  ]) {
    assert.ok(table.includes(required), `proposal history must include ${required}`);
  }
  assert.equal(table.includes("proposal_revision"), false);
  assert.ok(
    table.includes("source = 'player_edit'\n      AND actor_color IS NOT NULL\n      AND parent_scoring_revision IS NULL"),
    "a first manual proposal after unavailable analysis has no invented parent",
  );
  for (const forbidden of ["ownership", "provider_payload", "raw_response", "response_body"]) {
    assert.equal(table.includes(forbidden), false);
  }
  const validator = functionDefinition(migration, "validate_japanese_scoring_proposal_insert");
  const gameLock = validator.indexOf("FROM public.games WHERE id = NEW.game_id FOR UPDATE");
  const scoringLock = validator.indexOf("FROM public.game_japanese_scoring_state");
  assert.ok(gameLock >= 0 && scoringLock > gameLock);
  assert.ok(validator.includes("Initial proposal must preserve validated suggestion diagnostics."));
  assert.ok(validator.includes("First manual proposal requires unavailable suggestion evidence."));
  assert.ok(validator.includes("Proposal edits require earlier same-phase provenance."));
});

test("terminal evidence preserves validated scoring or an explicit no-result reason", () => {
  const table = tableDefinition(migration, "game_japanese_scoring_terminal_events");
  for (const outcome of [
    "katago_validated",
    "katago_low_confidence",
    "katago_unavailable",
    "no_participation",
    "abandonment",
  ]) {
    assert.ok(table.includes(`'${outcome}'`));
  }
  for (const field of [
    "captured_white_by_black_at_stop",
    "captured_black_by_white_at_stop",
    "living_black_stones",
    "living_white_stones",
    "black_territory",
    "white_territory",
    "dame_points",
    "territory_excluded_by_agreement",
    "dead_black_stones",
    "dead_white_stones",
    "black_prisoners_final",
    "white_prisoners_final",
    "black_total",
    "white_total",
    "winner_color",
    "margin",
    "suggestion_status",
    "suggestion_provider_kind",
    "suggestion_engine_version",
    "suggestion_model_version",
    "suggestion_config_version",
    "suggestion_confidence_policy_version",
    "suggestion_latency_ms",
  ]) {
    assert.ok(table.includes(field), `validated terminal evidence must retain ${field}`);
  }
  assert.ok(table.includes("black_total = black_territory + black_prisoners_final"));
  assert.ok(table.includes("white_total = white_territory + white_prisoners_final + komi"));
  assert.equal(table.includes("provider_payload"), false);
  const terminalValidator = functionDefinition(
    migration,
    "validate_japanese_scoring_terminal_insert",
  );
  assert.ok(terminalValidator.includes("NEW.suggestion_status := scoring_row.suggestion_status"));
});

test("terminal and proposal guards are game-first, append-only, and transaction-complete", () => {
  const terminal = functionDefinition(migration, "validate_japanese_scoring_terminal_insert");
  assert.ok(
    terminal.indexOf("FROM public.games WHERE id = NEW.game_id FOR UPDATE")
      < terminal.indexOf("FROM public.game_japanese_scoring_state"),
  );
  assert.ok(terminal.includes("statement_timestamp() < scoring_row.expires_at"));
  const commit = functionDefinition(migration, "validate_japanese_scoring_terminal_commit");
  assert.ok(commit.includes("game_row.status <> 'finished'"));
  assert.ok(commit.includes("game_row.has_state"));
  assert.ok(commit.includes("game_row.scoring_revision IS DISTINCT FROM NEW.scoring_revision"));

  const stateGuard = functionDefinition(migration, "guard_japanese_scoring_state_mutation");
  assert.ok(stateGuard.includes("game_japanese_scoring_terminal_events"));
  assert.ok(stateGuard.includes("game.finish_reason IN ('resignation', 'timeout')"));
  assert.ok(stateGuard.includes("Japanese participation evidence is monotonic."));
  assert.ok(stateGuard.includes("Proposal edits require the next game scoring revision"));
  assert.ok(stateGuard.includes("initial_suggestion_change"));

  for (const sql of [schema, migration]) {
    assert.ok(sql.includes("DEFERRABLE INITIALLY DEFERRED"));
    assert.ok(sql.includes("Japanese scoring history is append-only."));
    assert.ok(sql.includes("ALTER TABLE game_japanese_scoring_proposals ENABLE ROW LEVEL SECURITY"));
    assert.ok(sql.includes("ALTER TABLE game_japanese_scoring_terminal_events ENABLE ROW LEVEL SECURITY"));
    assert.ok(sql.includes("REVOKE ALL ON game_japanese_scoring_proposals FROM PUBLIC"));
    assert.ok(sql.includes("REVOKE ALL ON game_japanese_scoring_terminal_events FROM PUBLIC"));
  }
});

test("production preflight requires every activation boundary", () => {
  for (const required of [
    "requiredJapaneseProposalColumns",
    "requiredJapaneseTerminalColumns",
    "game_japanese_scoring_deadline_check",
    "game_japanese_scoring_participation_check",
    "game_japanese_scoring_suggestion_check",
    "game_japanese_scoring_proposals_pkey:game_japanese_scoring_proposals:p",
    "game_japanese_scoring_terminal_events_pkey:game_japanese_scoring_terminal_events:p",
    "game_japanese_scoring_terminal_commit_guard",
    "public.validate_japanese_scoring_terminal_insert()",
    "public.guard_japanese_append_only_evidence()",
  ]) {
    assert.ok(preflight.includes(required), `preflight must require ${required}`);
  }
});
