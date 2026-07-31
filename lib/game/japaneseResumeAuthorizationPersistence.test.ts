import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "db/migrations/023_japanese_resume_authorizations.sql"),
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
const rulesPolicy = readFileSync(
  join(process.cwd(), "lib/game/rulesPolicy.ts"),
  "utf8",
);

const tableName = "game_japanese_resume_authorizations";

function tableDefinition(sql: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${tableName} (`);
  assert.notEqual(start, -1, `${tableName} must be created`);
  const end = sql.indexOf("\n);", start);
  assert.notEqual(end, -1, `${tableName} definition must terminate`);
  return sql.slice(start, end + 3);
}

function functionDefinition(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
  assert.notEqual(start, -1, `${name} must be created`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name} definition must terminate`);
  return sql.slice(start, end + 4);
}

test("fresh and upgraded databases share the ordered three-resume envelope", () => {
  assert.equal(tableDefinition(schema), tableDefinition(migration));
  const table = tableDefinition(migration);
  for (const required of [
    "resumption_number INT NOT NULL",
    "scoring_revision INT NOT NULL",
    "PRIMARY KEY (game_id, resumption_number)",
    "UNIQUE (game_id, stopped_move_number)",
    "FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE",
    "CHECK (resumption_number BETWEEN 1 AND 3)",
    "CHECK (scoring_revision > 0)",
    "CHECK (rules = 'japanese')",
    "CHECK (rules_profile = 'japanese-1989-gostone-v1')",
    "CHECK (scoring_method = 'territory')",
    "CHECK (komi = 6.5)",
    "CHECK (handicap = 0)",
  ]) {
    assert.ok(table.includes(required), `authorization table must contain ${required}`);
  }
  for (const sql of [schema, migration]) {
    const constraint = sql.indexOf(
      "game_japanese_resume_authorizations_game_rules_fk",
    );
    assert.ok(constraint > sql.indexOf(`CREATE TABLE IF NOT EXISTS ${tableName}`));
    const block = sql.slice(constraint, constraint + 900);
    assert.ok(
      block.includes(
        "FOREIGN KEY (game_id, rules, rules_profile, scoring_method, komi, handicap)",
      ),
    );
    assert.ok(
      block.includes(
        "REFERENCES games (id, rules, rules_profile, scoring_method, komi, handicap)",
      ),
    );
    assert.ok(block.includes("ON DELETE CASCADE"));
  }
});

test("insert validation serializes game first and accepts zero or one confirmation", () => {
  const validator = functionDefinition(
    migration,
    "validate_game_japanese_resume_authorization_insert",
  );
  const gameLock = validator.indexOf("FROM public.games AS game");
  const stateLock = validator.indexOf(
    "FROM public.game_japanese_scoring_state AS scoring",
  );
  assert.ok(gameLock >= 0 && stateLock > gameLock);
  assert.ok(validator.indexOf("FOR UPDATE", gameLock) < stateLock);
  assert.ok(validator.indexOf("FOR UPDATE", stateLock) > stateLock);
  for (const required of [
    "COALESCE(MAX(resumption_number), 0) + 1",
    "expected_resumption_number > 3",
    "NEW.resumption_number IS DISTINCT FROM expected_resumption_number",
    "scoring_snapshot.finalized_at IS NOT NULL",
    "scoring_snapshot.black_confirmed_revision IS NOT NULL\n      AND scoring_snapshot.white_confirmed_revision IS NOT NULL",
    "NEW.scoring_revision IS DISTINCT FROM scoring_snapshot.revision",
    "latest_move.is_pass IS DISTINCT FROM TRUE",
    "prior_move.is_pass IS DISTINCT FROM TRUE",
    "NEW.authorized_at := statement_timestamp()",
  ]) {
    assert.ok(validator.includes(required), `insert validator must contain ${required}`);
  }
  assert.equal(validator.includes("AS authorization"), false);
});

test("authorized transition is opponent-first, revision-bound, and deletes scoring safely", () => {
  const transition = functionDefinition(
    migration,
    "guard_game_japanese_resume_transition",
  );
  for (const required of [
    "JOIN public.game_japanese_resume_authorizations AS resume_authorization",
    "resume_authorization.scoring_revision = scoring.revision",
    "resume_snapshot.finalized_at IS NOT NULL",
    "resume_snapshot.black_confirmed_revision IS NOT NULL\n      AND resume_snapshot.white_confirmed_revision IS NOT NULL",
    "CASE resume_snapshot.requested_by_color WHEN 'black' THEN 'white' ELSE 'black' END",
    "NEW.scoring_revision IS DISTINCT FROM OLD.scoring_revision + 1",
  ]) {
    assert.ok(transition.includes(required), `transition guard must contain ${required}`);
  }

  const scoringGuard = functionDefinition(
    migration,
    "guard_japanese_scoring_state_mutation",
  );
  for (const required of [
    "IF TG_OP = 'DELETE'",
    "JOIN public.game_japanese_resume_authorizations AS resume_authorization",
    "game.phase = 'play'",
    "game.scoring_revision = resume_authorization.scoring_revision + 1",
    "IF authorized_resume THEN",
    "Confirmed Japanese scoring state is immutable.",
  ]) {
    assert.ok(scoringGuard.includes(required), `scoring guard must contain ${required}`);
  }

  const commit = functionDefinition(
    migration,
    "validate_game_japanese_resume_authorization_commit",
  );
  assert.ok(commit.includes("lifecycle.has_japanese_scoring_state"));
  assert.ok(commit.includes("NEW.scoring_revision + 1"));
  assert.ok(commit.includes("CASE NEW.requested_by_color WHEN 'black' THEN 'white' ELSE 'black' END"));
});

test("authorization evidence is append-only, isolated, and deferred at commit", () => {
  for (const sql of [schema, migration]) {
    for (const required of [
      "game_japanese_resume_authorizations_insert_guard",
      "game_japanese_resume_authorizations_commit_guard",
      "game_japanese_resume_authorizations_immutable_guard",
      "game_japanese_resume_authorizations_truncate_guard",
      "game_japanese_resume_transition_guard",
      "DEFERRABLE INITIALLY DEFERRED",
      "ALTER TABLE game_japanese_resume_authorizations ENABLE ROW LEVEL SECURITY",
      "REVOKE ALL ON game_japanese_resume_authorizations FROM PUBLIC",
    ]) {
      assert.ok(sql.includes(required), `persistence SQL must contain ${required}`);
    }
    assert.match(
      sql,
      /REVOKE ALL ON[\s\S]*game_japanese_resume_authorizations[\s\S]*FROM anon;/,
    );
    assert.match(
      sql,
      /REVOKE ALL ON[\s\S]*game_japanese_resume_authorizations[\s\S]*FROM authenticated;/,
    );
  }
  const mutation = functionDefinition(
    migration,
    "guard_game_japanese_resume_authorization_mutation",
  );
  assert.ok(mutation.includes("TG_OP = 'TRUNCATE'"));
  assert.ok(mutation.includes("PERFORM 1 FROM public.games WHERE id = OLD.game_id"));
  assert.ok(mutation.includes("Japanese resume authorizations are append-only."));
});

test("migration remains dormant and production preflight verifies its boundary", () => {
  assert.ok(migration.includes("SET LOCAL lock_timeout = '5s'"));
  assert.doesNotMatch(migration, /^\s*(?:UPDATE|DELETE|DROP)\s/gim);
  assert.doesNotMatch(migration, /ALTER TABLE (?:games|matchmaking_queue)\b/i);
  assert.equal(gameService.includes(tableName), false);
  assert.equal(rulesPolicy.includes("japanese-1989-gostone-v1"), false);

  for (const required of [
    tableName,
    "requiredJapaneseResumeAuthorizationColumns",
    "japanese_resume_authorization_columns",
    "game_japanese_resume_authorizations_pkey:game_japanese_resume_authorizations:p",
    "game_japanese_resume_authorizations_number_check:game_japanese_resume_authorizations:c",
    "game_japanese_resume_authorizations_game_rules_fk:game_japanese_resume_authorizations:f",
    "game_japanese_resume_authorizations_insert_guard:game_japanese_resume_authorizations:public:validate_game_japanese_resume_authorization_insert:7",
    "game_japanese_resume_authorizations_commit_guard:game_japanese_resume_authorizations:public:validate_game_japanese_resume_authorization_commit:5",
    "game_japanese_resume_transition_guard:games:public:guard_game_japanese_resume_transition:19",
    "public.guard_japanese_scoring_state_mutation()",
  ]) {
    assert.ok(productionPreflight.includes(required), `preflight must require ${required}`);
  }
});
