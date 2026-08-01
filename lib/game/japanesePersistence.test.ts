import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { JAPANESE_1989_RULES_PROFILE } from "./japanesePolicyContract";
import { RULES_POLICIES } from "./rulesPolicy";

const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "db/migrations/009_japanese_persistence_foundation.sql"),
  "utf8",
);
const matchmakingService = readFileSync(
  join(process.cwd(), "lib/matchmaking/matchmakingService.ts"),
  "utf8",
);
const productionPreflight = readFileSync(
  join(process.cwd(), "scripts/check-mvp.ts"),
  "utf8",
);

function tableDefinition(sql: string, table: string): string {
  const startMarker = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const start = sql.indexOf(startMarker);
  assert.notEqual(start, -1, `${table} must be created`);
  const end = sql.indexOf("\n);", start);
  assert.notEqual(end, -1, `${table} definition must terminate`);
  return sql.slice(start, end + 3);
}

function functionDefinition(sql: string, name: string): string {
  const startMarker = `CREATE OR REPLACE FUNCTION public.${name}()`;
  const start = sql.indexOf(startMarker);
  assert.notEqual(start, -1, `${name} must be created`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name} definition must terminate`);
  return sql.slice(start, end + 4);
}

function assertBothContain(fragment: string): void {
  assert.ok(schema.includes(fragment), `schema.sql must contain: ${fragment}`);
  assert.ok(migration.includes(fragment), `migration 009 must contain: ${fragment}`);
}

test("reserves the exact Japanese tuple used by the active application policy", () => {
  const tuple = [
    "rules = 'japanese'",
    `rules_profile = '${JAPANESE_1989_RULES_PROFILE}'`,
    "scoring_method = 'territory'",
    "komi = 6.5",
    "handicap = 0",
  ];
  tuple.forEach(assertBothContain);

  assert.equal(Object.hasOwn(RULES_POLICIES, JAPANESE_1989_RULES_PROFILE), true);
  assert.ok(
    schema.includes(
      "CHECK (rules_profile IN ('legacy-immediate-area', 'chinese-2002-gostone-v1'))",
    ),
  );
  assert.ok(schema.includes("CHECK (scoring_method = 'area')"));
  assert.ok(schema.includes("CHECK (rules = 'chinese')"));
  assert.equal(migration.includes("DROP CONSTRAINT"), false);
});

test("keeps both Chinese queue profiles rollout-compatible and Japanese closed", () => {
  assertBothContain("matchmaking_queue_rules_profile_compatibility_check");
  assertBothContain("'legacy-immediate-area'");
  assertBothContain("'chinese-2002-gostone-v1'");
  assertBothContain("SET rules_profile = games.rules_profile");
  assertBothContain("WHERE status = 'waiting'");
  assertBothContain("enforce_matchmaking_rules_profile");
  assertBothContain("matchmaking_rules_profile_guard");
  assert.ok(migration.includes("SET LOCAL lock_timeout = '5s'"));
  assert.ok(migration.includes("SET LOCAL statement_timeout = '60s'"));
  assert.ok(
    matchmakingService.includes("SET player_key = EXCLUDED.player_key"),
  );
  assert.ok(matchmakingService.includes("rules_profile = $4,"));
  assert.ok(matchmakingService.includes("AND q.rules_profile = $3"));
  assert.ok(matchmakingService.includes("rules_profile = $2"));
  assert.equal(
    tableDefinition(schema, "matchmaking_queue").includes(
      "japanese-1989-gostone-v1",
    ),
    false,
  );
});

test("persists Japanese agreement evidence in a separate protected table family", () => {
  const tableNames = [
    "game_japanese_scoring_state",
    "game_japanese_dead_stones",
    "game_japanese_neutral_region_seeds",
  ];
  for (const table of tableNames) {
    assertBothContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    assertBothContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  }

  const state = tableDefinition(migration, "game_japanese_scoring_state");
  for (const field of [
    "captured_white_by_black_at_stop",
    "captured_black_by_white_at_stop",
    "proposal_hash",
    "black_confirmed_revision",
    "white_confirmed_revision",
    "black_confirmed_proposal_hash",
    "white_confirmed_proposal_hash",
    "scored_proposal_hash",
    "territory_excluded_by_agreement",
    "black_prisoners_final",
    "white_prisoners_final",
    "outcome_kind",
    "scored_board_hash",
  ]) {
    assert.ok(state.includes(field), `Japanese scoring state must persist ${field}`);
  }
  assert.equal(state.includes("expires_at"), false);
  assert.equal(state.includes("fallback_to_move"), false);
  assert.equal(state.includes("result TEXT"), false);
  assert.ok(
    state.includes(
      "black_prisoners_final = captured_white_by_black_at_stop + dead_white_stones",
    ),
  );
  assert.ok(
    state.includes(
      "white_prisoners_final = captured_black_by_white_at_stop + dead_black_stones",
    ),
  );
  assert.ok(
    state.includes("black_confirmed_revision = revision")
      && state.includes("white_confirmed_revision = revision")
      && state.includes("black_confirmed_proposal_hash = proposal_hash")
      && state.includes("white_confirmed_proposal_hash = proposal_hash")
      && state.includes("scored_proposal_hash = proposal_hash"),
  );
  for (const requiredNonNull of [
    "black_confirmed_revision IS NOT NULL",
    "white_confirmed_revision IS NOT NULL",
    "black_confirmed_proposal_hash IS NOT NULL",
    "white_confirmed_proposal_hash IS NOT NULL",
    "scored_proposal_hash IS NOT NULL",
    "winner IS NOT NULL",
  ]) {
    assert.ok(state.includes(requiredNonNull));
  }
  for (const table of [
    "game_japanese_dead_stones",
    "game_japanese_neutral_region_seeds",
  ]) {
    const evidence = tableDefinition(migration, table);
    assert.ok(evidence.includes("revision INT NOT NULL"));
    assert.ok(evidence.includes("proposal_hash TEXT NOT NULL"));
    assert.ok(
      evidence.includes("FOREIGN KEY (game_id, revision, proposal_hash)"),
    );
  }
  assertBothContain("guard_japanese_scoring_state_mutation");
  assertBothContain("guard_japanese_scoring_evidence_mutation");
  assertBothContain("Confirmed Japanese scoring evidence is immutable.");
  assertBothContain("proposal_inputs_changed");
  assertBothContain("Japanese scoring evidence identity is immutable.");
  assertBothContain("Confirmed Japanese scoring state is immutable.");
  for (const sql of [schema, migration]) {
    assert.match(
      sql,
      /REVOKE ALL ON[\s\S]*game_japanese_scoring_state[\s\S]*FROM anon;/,
    );
    assert.match(
      sql,
      /REVOKE ALL ON[\s\S]*game_japanese_scoring_state[\s\S]*FROM authenticated;/,
    );
  }
});

test("binds both scoring variants to their game's exact parent rules tuple", () => {
  for (const sql of [schema, migration]) {
    assert.ok(sql.includes("games_rules_identity_unique"));
    assert.ok(sql.includes("game_scoring_state_game_rules_fk"));
    assert.ok(sql.includes("game_japanese_scoring_game_rules_fk"));
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
  }
});

test("keeps fresh and upgraded Japanese table definitions byte-stable", () => {
  for (const table of [
    "game_japanese_scoring_state",
    "game_japanese_dead_stones",
    "game_japanese_neutral_region_seeds",
  ]) {
    assert.equal(tableDefinition(schema, table), tableDefinition(migration, table));
  }
  for (const fn of [
    "enforce_matchmaking_rules_profile",
    "guard_game_rules_identity_mutation",
    "guard_japanese_scoring_evidence_mutation",
  ]) {
    assert.equal(functionDefinition(schema, fn), functionDefinition(migration, fn));
  }
  assert.ok(
    functionDefinition(schema, "guard_japanese_scoring_state_mutation").includes(
      "game_japanese_resume_authorizations",
    ),
    "schema.sql must include migration 023's authorized-delete exception",
  );
});

test("adds tuple constraints after idempotent schema upgrades", () => {
  const columnUpgrade = schema.indexOf(
    "ALTER TABLE games ADD COLUMN IF NOT EXISTS rules_profile TEXT",
  );
  const profileBackfill = schema.indexOf(
    "SET rules_profile = 'legacy-immediate-area'",
  );
  const tupleConstraint = schema.indexOf("games_rules_identity_unique");
  const japaneseCompositeForeignKey = schema.indexOf(
    "game_japanese_scoring_game_rules_fk",
  );

  assert.ok(columnUpgrade >= 0);
  assert.ok(profileBackfill > columnUpgrade);
  assert.ok(tupleConstraint > profileBackfill);
  assert.ok(japaneseCompositeForeignKey > tupleConstraint);
  assert.ok(
    schema.indexOf(
      "VALIDATE CONSTRAINT game_japanese_scoring_game_rules_fk",
    ) > japaneseCompositeForeignKey,
  );
});

test("production preflight requires the complete dormant persistence contract", () => {
  for (const required of [
    "game_japanese_scoring_state",
    "game_japanese_dead_stones",
    "game_japanese_neutral_region_seeds",
    "proposal_hash",
    "matchmaking_queue_rules_profile_compatibility_check",
    "matchmaking_rules_profile_guard",
    "game_rules_identity_mutation_guard",
    "game_japanese_scoring_state_mutation_guard",
    "game_japanese_dead_stones_mutation_guard",
    "game_japanese_neutral_seeds_mutation_guard",
  ]) {
    assert.ok(
      productionPreflight.includes(required),
      `production preflight must require ${required}`,
    );
  }
  assert.ok(productionPreflight.includes("tgenabled IN ('O', 'A')"));
  assert.ok(productionPreflight.includes("relation.relrowsecurity"));
  assert.ok(productionPreflight.includes("has_table_privilege"));
  assert.ok(productionPreflight.includes("has_any_column_privilege"));
  assert.ok(productionPreflight.includes("has_function_privilege"));
  assert.ok(productionPreflight.includes("pg_get_constraintdef"));
  assert.ok(productionPreflight.includes("pg_get_triggerdef"));
});
