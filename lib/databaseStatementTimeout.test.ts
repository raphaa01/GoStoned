import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../db/migrations/016_database_statement_timeout.sql", import.meta.url),
  "utf8",
);
const migrationRunner = readFileSync(
  new URL("../scripts/migrate.ts", import.meta.url),
  "utf8",
);

test("fresh and upgraded databases share one role-and-database statement timeout", () => {
  assert.ok(schema.endsWith(migration), "Canonical schema must end with migration 016.");
  assert.match(migration, /current_user <> session_user/);
  assert.match(
    migration,
    /ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L[\s\S]+current_user,[\s\S]+current_database\(\),[\s\S]+'8s'/,
  );
  assert.match(migration, /'statement_timeout=8s' = ANY\(setting\.setconfig\)/);
  assert.doesNotMatch(migration, /ALTER DATABASE|ALTER ROLE ALL|ALTER ROLE %I SET statement_timeout/);
});

test("migration sessions disable and verify the application timeout before taking the lock", () => {
  const disable = migrationRunner.indexOf("await disableMigrationStatementTimeout(client)");
  const searchPath = migrationRunner.indexOf("await setTrustedSearchPath(client)", disable);
  const lock = migrationRunner.indexOf("await acquireMigrationLock(client)", searchPath);
  assert.ok(disable >= 0 && searchPath > disable && lock > searchPath);
  assert.match(migrationRunner, /SET statement_timeout = '0'/);
  assert.match(migrationRunner, /current_setting\('statement_timeout'\)/);
  assert.match(migrationRunner, /statementTimeout !== "0"/);
});
