import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function source(path: string) {
  return readFile(`${root}/${path}`, "utf8");
}

async function sourceTree(relativeRoot: string): Promise<Array<{ path: string; value: string }>> {
  const absoluteRoot = path.join(root, relativeRoot);
  const files: Array<{ path: string; value: string }> = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        files.push({
          path: path.relative(root, absolutePath),
          value: await readFile(absolutePath, "utf8"),
        });
      }
    }
  }
  await visit(absoluteRoot);
  return files;
}

function reportTable(sql: string) {
  return sql.match(/CREATE TABLE IF NOT EXISTS player_reports \(([\s\S]*?)\n\);/)?.[1] ?? "";
}

function assertReportContract(sql: string) {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS player_reports/);
  assert.match(sql, /CONSTRAINT player_reports_pkey PRIMARY KEY \(game_id, reporter_key\)/);
  assert.match(sql, /CONSTRAINT player_reports_game_fk FOREIGN KEY \(game_id\)\s+REFERENCES games\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /CONSTRAINT player_reports_distinct_players_check CHECK \(reporter_key <> reported_key\)/);
  assert.match(sql, /CONSTRAINT player_reports_key_bounds_check CHECK/);
  assert.match(sql, /CONSTRAINT player_reports_category_check CHECK/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_player_reports_reported_created\s+ON player_reports\(reported_key, created_at DESC, game_id, reporter_key\)/);
  assert.match(sql, /ALTER TABLE player_reports ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON [^;]*player_reports[^;]* FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON [^;]*player_reports[^;]* FROM anon/);
  assert.match(sql, /REVOKE ALL ON [^;]*player_reports[^;]* FROM authenticated/);
}

test("bootstrap and migration share the protected immutable intake contract", async () => {
  const [schema, migration] = await Promise.all([
    source("db/schema.sql"),
    source("db/migrations/014_player_reports.sql"),
  ]);
  assertReportContract(schema);
  assertReportContract(migration);
  assert.equal(reportTable(schema), reportTable(migration));
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test("report evidence cannot cascade with game or guest-session cleanup", async () => {
  const [migration, guestSessions] = await Promise.all([
    source("db/migrations/014_player_reports.sql"),
    source("lib/auth/guestSession.ts"),
  ]);
  assert.match(migration, /REFERENCES games\(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /REFERENCES games\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(guestSessions, /player_reports/);
});

test("report intake stores bounded classification metadata and no free text or review state", async () => {
  const migration = await source("db/migrations/014_player_reports.sql");
  const table = reportTable(migration);
  assert.ok(table);
  for (const category of [
    "abuse_or_hate",
    "threat_or_sexual_safety",
    "fair_play",
    "stalling_or_abandonment",
    "spam_scam_or_identity",
    "other",
  ]) {
    assert.match(table, new RegExp(`'${category}'`));
  }
  assert.doesNotMatch(
    table,
    /message|details|description|transcript|ip_address|user_agent|status|reviewer|moderator|enforcement|contact/i,
  );
});

test("production preflight verifies report table, index, constraints, RLS, and grants", async () => {
  const preflight = await source("scripts/check-mvp.ts");
  assert.match(preflight, /requiredTables[\s\S]*"player_reports"/);
  assert.match(preflight, /idx_player_reports_reported_created/);
  for (const signature of [
    "player_reports_pkey:player_reports:p",
    "player_reports_game_fk:player_reports:f",
    "player_reports_distinct_players_check:player_reports:c",
    "player_reports_key_bounds_check:player_reports:c",
    "player_reports_category_check:player_reports:c",
  ]) {
    assert.match(preflight, new RegExp(signature));
  }
  assert.match(preflight, /requiredProtectedTables[\s\S]*"player_reports"/);
  assert.match(preflight, /public_has_table_access/);
  assert.match(preflight, /client_roles_have_table_access/);
});

test("the player-facing action remains release-gated until triage exists", async () => {
  const [runbook, gate, ...renderedTrees] = await Promise.all([
    source("docs/player-reporting.md"),
    source("lib/moderation/playerReportGate.ts"),
    sourceTree("app/(en)"),
    sourceTree("app/(de)"),
    sourceTree("components"),
  ]);
  assert.match(runbook, /must not be presented to players until/i);
  assert.match(runbook, /Name the person or team responsible for triage/i);
  assert.match(runbook, /retention/i);
  assert.match(gate, /value === "true"/);
  const renderedSources = renderedTrees.flat();
  for (const rendered of renderedSources) {
    assert.doesNotMatch(
      rendered.value,
      /\/api\/games\/[\s\S]{0,80}\/report|playerReport|PLAYER_REPORT_CATEGORIES|reportGameOpponent/,
      `reporting must remain absent from ${rendered.path}`,
    );
  }
});
