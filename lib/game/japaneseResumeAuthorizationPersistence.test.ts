import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
const migration = readFileSync(
  join(
    process.cwd(),
    "db/migrations/017_game_japanese_resume_authorizations.sql",
  ),
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
const functionNames = [
  "guard_game_japanese_resume_authorization_mutation",
  "validate_game_japanese_resume_authorization_insert",
  "validate_game_japanese_resume_authorization_commit",
  "guard_game_japanese_resume_transition",
] as const;

function tableDefinition(sql: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${tableName} (`);
  assert.notEqual(start, -1, "Japanese resume authorization table must be created");
  const end = sql.indexOf("\n);", start);
  assert.notEqual(end, -1, "Japanese resume authorization table must terminate");
  return sql.slice(start, end + 3);
}

function functionDefinition(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}()`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `${name} must be created`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name} must terminate`);
  return sql.slice(start, end + 4);
}

function triggerBlock(sql: string, triggerName: string): string {
  const start = sql.indexOf(`WHERE tgname = '${triggerName}'`);
  assert.notEqual(start, -1, `${triggerName} must have an idempotent guard`);
  const end = sql.indexOf("  END IF;", start);
  assert.notEqual(end, -1, `${triggerName} guard must terminate`);
  return sql.slice(start, end + 9);
}

test("fresh and upgraded databases share the exact minimal authorization envelope", () => {
  assert.equal(tableDefinition(schema), tableDefinition(migration));
  for (const name of functionNames) {
    assert.equal(functionDefinition(schema, name), functionDefinition(migration, name));
  }

  const columns = [
    ...tableDefinition(migration).matchAll(
      /^  ([a-z][a-z0-9_]*) (?:UUID|INT|TEXT|NUMERIC\(4,1\))/gm,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(columns, [
    "game_id",
    "stopped_move_number",
    "stopped_board_hash",
    "requested_by_color",
    "rules",
    "rules_profile",
    "scoring_method",
    "komi",
    "handicap",
  ]);

  for (const forbidden of [
    "scoring_revision",
    "resumed_at",
    "created_at",
    "updated_at",
    "proposal_hash",
    "resumed_to_move",
    "event_id",
    "resume_claim",
    "deadline",
    "fallback",
  ]) {
    assert.equal(
      tableDefinition(migration).includes(forbidden),
      false,
      `authorization table must not persist ${forbidden}`,
    );
  }
});

test("table identity is bounded by direct parent and exact Japanese tuple constraints", () => {
  const table = tableDefinition(migration);
  for (const required of [
    "PRIMARY KEY (game_id, stopped_move_number)",
    "game_japanese_resume_authorizations_game_fk",
    "FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE",
    "CHECK (stopped_move_number >= 2)",
    "CHECK (LENGTH(stopped_board_hash) > 0)",
    "CHECK (requested_by_color IN ('black', 'white'))",
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
    const block = sql.slice(constraint, constraint + 1_200);
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
    assert.ok(
      block.includes(
        "conrelid = 'public.game_japanese_resume_authorizations'::regclass",
      ),
    );
  }
  assert.ok(
    schema.indexOf("game_japanese_resume_authorizations_game_rules_fk")
      > schema.indexOf("games_rules_identity_unique"),
  );
});

test("insert validation locks game then state and binds the immutable pass-pass stop", () => {
  const validator = functionDefinition(
    migration,
    "validate_game_japanese_resume_authorization_insert",
  );
  const gameLock = validator.indexOf("FROM public.games AS game");
  const stateLock = validator.indexOf(
    "FROM public.game_japanese_scoring_state AS scoring",
  );
  const latestMoveLock = validator.indexOf("FROM public.moves AS move");
  assert.ok(gameLock >= 0);
  assert.ok(stateLock > gameLock);
  assert.ok(latestMoveLock > stateLock);
  assert.ok(validator.indexOf("FOR UPDATE", gameLock) < stateLock);
  assert.ok(validator.indexOf("FOR UPDATE", stateLock) < latestMoveLock);
  assert.equal(validator.match(/FOR SHARE/g)?.length, 2);

  for (const required of [
    "game_snapshot.status <> 'active'",
    "game_snapshot.phase <> 'scoring'",
    "game_snapshot.to_move IS NOT NULL",
    "game_snapshot.consecutive_passes <> 2",
    "scoring_snapshot.finalized_at IS NOT NULL",
    "scoring_snapshot.black_confirmed_revision IS NOT NULL",
    "scoring_snapshot.white_confirmed_revision IS NOT NULL",
    "scoring_snapshot.revision IS DISTINCT FROM game_snapshot.scoring_revision",
    "NEW.stopped_board_hash IS DISTINCT FROM scoring_snapshot.board_hash",
    "NEW.stopped_move_number IS DISTINCT FROM scoring_snapshot.stopped_move_number",
    "ORDER BY move.move_number DESC",
    "latest_move.move_number IS DISTINCT FROM NEW.stopped_move_number",
    "prior_move.move_number IS DISTINCT FROM NEW.stopped_move_number - 1",
    "latest_move.is_pass IS DISTINCT FROM TRUE",
    "prior_move.is_pass IS DISTINCT FROM TRUE",
    "latest_move.board_hash IS DISTINCT FROM NEW.stopped_board_hash",
    "prior_move.board_hash IS DISTINCT FROM NEW.stopped_board_hash",
    "CASE prior_move.color WHEN 'black' THEN 'white' ELSE 'black' END",
  ]) {
    assert.ok(validator.includes(required), `insert validator must contain ${required}`);
  }
});

test("both sides enforce one authorized opponent-first scoring-to-play transition", () => {
  const commit = functionDefinition(
    migration,
    "validate_game_japanese_resume_authorization_commit",
  );
  for (const required of [
    "lifecycle.status <> 'active'",
    "lifecycle.phase <> 'play'",
    "lifecycle.consecutive_passes <> 0",
    "CASE NEW.requested_by_color WHEN 'black' THEN 'white' ELSE 'black' END",
    "lifecycle.has_japanese_scoring_state",
  ]) {
    assert.ok(commit.includes(required), `commit validator must contain ${required}`);
  }

  const reverse = functionDefinition(
    migration,
    "guard_game_japanese_resume_transition",
  );
  for (const required of [
    "OLD.rules = 'japanese'",
    "OLD.rules_profile = 'japanese-1989-gostone-v1'",
    "OLD.phase = 'scoring'",
    "NEW.phase = 'play'",
    "JOIN public.game_japanese_resume_authorizations AS authorization",
    "authorization.stopped_move_number = scoring.stopped_move_number",
    "authorization.stopped_board_hash = scoring.board_hash",
    "resume_snapshot.finalized_at IS NOT NULL",
    "resume_snapshot.black_confirmed_revision IS NOT NULL",
    "resume_snapshot.white_confirmed_revision IS NOT NULL",
    "OLD.status <> 'active'",
    "OLD.to_move IS NOT NULL",
    "OLD.consecutive_passes <> 2",
    "OLD.scoring_revision IS DISTINCT FROM resume_snapshot.revision",
    "NEW.status <> 'active'",
    "CASE resume_snapshot.requested_by_color WHEN 'black' THEN 'white' ELSE 'black' END",
    "NEW.consecutive_passes <> 0",
    "NEW.scoring_revision IS DISTINCT FROM OLD.scoring_revision + 1",
  ]) {
    assert.ok(reverse.includes(required), `reverse guard must contain ${required}`);
  }
});

test("authorization writes are append-only, isolated, and guarded by exact trigger types", () => {
  for (const sql of [schema, migration]) {
    const mutation = functionDefinition(
      sql,
      "guard_game_japanese_resume_authorization_mutation",
    );
    assert.ok(mutation.includes("TG_OP = 'TRUNCATE'"));
    assert.ok(mutation.includes("FROM public.games WHERE id = OLD.game_id"));
    assert.ok(mutation.includes("Japanese resume authorizations are append-only."));

    const triggers = {
      game_japanese_resume_authorizations_insert_guard:
        "BEFORE INSERT ON public.game_japanese_resume_authorizations",
      game_japanese_resume_authorizations_commit_guard:
        "AFTER INSERT ON public.game_japanese_resume_authorizations",
      game_japanese_resume_authorizations_immutable_guard:
        "BEFORE UPDATE OR DELETE ON public.game_japanese_resume_authorizations",
      game_japanese_resume_authorizations_truncate_guard:
        "BEFORE TRUNCATE ON public.game_japanese_resume_authorizations",
      game_japanese_resume_transition_guard:
        "BEFORE UPDATE OF status, phase, to_move, consecutive_passes, scoring_revision",
    } as const;
    for (const [name, definition] of Object.entries(triggers)) {
      const block = triggerBlock(sql, name);
      assert.ok(block.includes(definition));
      assert.ok(block.includes("tgrelid = 'public."));
      assert.ok(block.includes("AND NOT tgisinternal"));
    }
    assert.ok(
      sql.includes(
        "AFTER INSERT ON public.game_japanese_resume_authorizations\n      DEFERRABLE INITIALLY DEFERRED",
      ),
    );
    assert.ok(
      sql.includes(
        "ALTER TABLE game_japanese_resume_authorizations ENABLE ROW LEVEL SECURITY",
      ),
    );
    assert.ok(
      sql.includes("REVOKE ALL ON game_japanese_resume_authorizations FROM PUBLIC"),
    );
    assert.match(
      sql,
      /REVOKE ALL ON[\s\S]*game_japanese_resume_authorizations[\s\S]*FROM anon;/,
    );
    assert.match(
      sql,
      /REVOKE ALL ON[\s\S]*game_japanese_resume_authorizations[\s\S]*FROM authenticated;/,
    );
    for (const name of functionNames) {
      assert.ok(
        sql.includes(`REVOKE ALL ON FUNCTION public.${name}() FROM PUBLIC`),
      );
      const definition = functionDefinition(sql, name);
      assert.ok(definition.includes("SET search_path = pg_catalog, public"));
      assert.equal(definition.includes("SECURITY DEFINER"), false);
    }
  }
  assert.equal(/CREATE\s+POLICY/i.test(migration), false);
});

test("migration is additive, bounded, and does not activate Japanese play", () => {
  assert.ok(migration.includes("SET LOCAL lock_timeout = '5s'"));
  assert.ok(migration.includes("SET LOCAL statement_timeout = '60s'"));
  assert.doesNotMatch(migration, /^\s*(?:INSERT|UPDATE|DELETE|DROP)\s/gim);
  assert.doesNotMatch(migration, /ALTER TABLE (?:games|matchmaking_queue)\b/i);
  assert.equal(gameService.includes(tableName), false);
  assert.equal(gameService.includes("japanesePhaseAuthority"), false);
  assert.equal(rulesPolicy.includes("japanese-1989-gostone-v1"), false);
  assert.equal(rulesPolicy.includes("game_japanese_resume_authorizations"), false);
});

test("production preflight verifies the complete dormant authorization boundary", () => {
  for (const required of [
    "game_japanese_resume_authorizations",
    "japanese_resume_authorization_columns",
    "game_japanese_resume_authorizations_pkey:game_japanese_resume_authorizations:p",
    "game_japanese_resume_authorizations_game_fk:game_japanese_resume_authorizations:f",
    "game_japanese_resume_authorizations_stopped_move_check:game_japanese_resume_authorizations:c",
    "game_japanese_resume_authorizations_board_hash_check:game_japanese_resume_authorizations:c",
    "game_japanese_resume_authorizations_requested_by_check:game_japanese_resume_authorizations:c",
    "game_japanese_resume_authorizations_rules_check:game_japanese_resume_authorizations:c",
    "game_japanese_resume_authorizations_rules_profile_check:game_japanese_resume_authorizations:c",
    "game_japanese_resume_authorizations_scoring_method_check:game_japanese_resume_authorizations:c",
    "game_japanese_resume_authorizations_komi_check:game_japanese_resume_authorizations:c",
    "game_japanese_resume_authorizations_handicap_check:game_japanese_resume_authorizations:c",
    "game_japanese_resume_authorizations_game_rules_fk:game_japanese_resume_authorizations:f",
    "game_japanese_resume_authorizations_insert_guard:game_japanese_resume_authorizations:public:validate_game_japanese_resume_authorization_insert:7",
    "game_japanese_resume_authorizations_commit_guard:game_japanese_resume_authorizations:public:validate_game_japanese_resume_authorization_commit:5",
    "game_japanese_resume_authorizations_immutable_guard:game_japanese_resume_authorizations:public:guard_game_japanese_resume_authorization_mutation:27",
    "game_japanese_resume_authorizations_truncate_guard:game_japanese_resume_authorizations:public:guard_game_japanese_resume_authorization_mutation:34",
    "game_japanese_resume_transition_guard:games:public:guard_game_japanese_resume_transition:19",
    "public.validate_game_japanese_resume_authorization_insert()",
    "public.validate_game_japanese_resume_authorization_commit()",
    "public.guard_game_japanese_resume_authorization_mutation()",
    "public.guard_game_japanese_resume_transition()",
    "japanese_resume_authorization_has_policies",
    "guard_functions_are_security_definer",
    "unexpectedJapaneseResumeAuthorizationColumns",
  ]) {
    assert.ok(productionPreflight.includes(required), `preflight must require ${required}`);
  }
  assert.ok(productionPreflight.includes("relation.relrowsecurity"));
  assert.ok(productionPreflight.includes("has_table_privilege"));
  assert.ok(productionPreflight.includes("has_any_column_privilege"));
  assert.ok(productionPreflight.includes("has_function_privilege"));
  assert.ok(productionPreflight.includes("pg_get_constraintdef"));
  assert.ok(productionPreflight.includes("pg_get_triggerdef"));
  assert.ok(productionPreflight.includes("pg_get_functiondef"));
});
