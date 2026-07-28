import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import { closePool, query } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { reportGameOpponent } from "../lib/moderation/playerReportService";

type ReportRow = {
  game_id: string;
  reporter_key: string;
  reported_key: string;
  category_code: string;
};

const databaseUrl = getDatabaseUrl();
if (!isUnambiguousLocalDatabase(databaseUrl)) {
  throw new Error("Player-report race smoke tests may only mutate a local PostgreSQL database.");
}

const blackPlayer = `guest:${randomUUID()}`;
const whitePlayer = `guest:${randomUUID()}`;
const gameIds: string[] = [];

async function createGame() {
  const result = await query<{ id: string }>(
    `INSERT INTO games (board_size, black_player_key, white_player_key)
     VALUES (9, $1, $2)
     RETURNING id`,
    [blackPlayer, whitePlayer],
  );
  gameIds.push(result.rows[0].id);
  return result.rows[0].id;
}

async function reportsFor(gameId: string) {
  const result = await query<ReportRow>(
    `SELECT game_id::text, reporter_key, reported_key, category_code
       FROM player_reports
      WHERE game_id = $1
      ORDER BY reporter_key`,
    [gameId],
  );
  return result.rows;
}

async function cleanup() {
  if (gameIds.length === 0) return;
  await query("DELETE FROM player_reports WHERE game_id = ANY($1::uuid[])", [gameIds]);
  await query("DELETE FROM games WHERE id = ANY($1::uuid[])", [gameIds]);
}

async function run() {
  const table = await query<{ table_name: string | null }>(
    "SELECT to_regclass('public.player_reports')::text AS table_name",
  );
  assert.equal(
    table.rows[0]?.table_name,
    "player_reports",
    "Apply 014_player_reports.sql to the isolated local database first.",
  );

  await cleanup();
  try {
    const contestedGame = await createGame();
    const receipts = await Promise.all([
      reportGameOpponent(contestedGame, blackPlayer, "fair_play"),
      reportGameOpponent(contestedGame, blackPlayer, "abuse_or_hate"),
      reportGameOpponent(contestedGame, blackPlayer, "stalling_or_abandonment"),
    ]);
    assert.ok(receipts.every((receipt) => receipt.reported));
    const contestedRows = await reportsFor(contestedGame);
    assert.equal(contestedRows.length, 1);
    assert.equal(contestedRows[0].reported_key, whitePlayer);
    assert.ok([
      "fair_play",
      "abuse_or_hate",
      "stalling_or_abandonment",
    ].includes(contestedRows[0].category_code));

    const reciprocalGame = await createGame();
    await Promise.all([
      reportGameOpponent(reciprocalGame, blackPlayer, "other"),
      reportGameOpponent(reciprocalGame, whitePlayer, "spam_scam_or_identity"),
    ]);
    const reciprocalRows = await reportsFor(reciprocalGame);
    assert.equal(reciprocalRows.length, 2);
    assert.deepEqual(
      reciprocalRows.map((row) => [row.reporter_key, row.reported_key]).sort(),
      [
        [blackPlayer, whitePlayer],
        [whitePlayer, blackPlayer],
      ].sort(),
    );

    console.log("PostgreSQL player-report concurrency smoke passed.");
  } finally {
    await cleanup();
  }
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
