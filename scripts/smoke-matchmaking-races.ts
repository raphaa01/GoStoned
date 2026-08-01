import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import { closePool, getPool, query } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import {
  cancelMatchmaking,
  getMatchmakingStatus,
  joinMatchmaking,
} from "../lib/matchmaking/matchmakingService";

type GameCountRow = {
  active_games: string;
};

const databaseUrl = getDatabaseUrl();
if (!isUnambiguousLocalDatabase(databaseUrl)) {
  throw new Error("Matchmaking race smoke tests may only mutate a local PostgreSQL database.");
}

const suffix = randomUUID();
const simultaneous = [`guest:sim-a-${suffix}`, `guest:sim-b-${suffix}`];
const repeated = `guest:repeat-${suffix}`;
const rapidOpponent = `guest:rapid-${suffix}`;
const classicOpponent = `guest:classic-${suffix}`;
const cancellationTarget = `guest:cancel-target-${suffix}`;
const cancellationPeer = `guest:cancel-peer-${suffix}`;
const playerKeys = [
  ...simultaneous,
  repeated,
  rapidOpponent,
  classicOpponent,
  cancellationTarget,
  cancellationPeer,
];

async function assertIsolatedPools() {
  const result = await query<{ player_key: string }>(
    `SELECT player_key
       FROM matchmaking_queue
      WHERE board_size = 9
        AND time_control = ANY($1::text[])
        AND rules_profile = 'chinese-2002-gostone-v1'
        AND NOT (player_key = ANY($2::text[]))
      LIMIT 1`,
    [["rapid", "classic"], playerKeys],
  );
  if (result.rows[0]) {
    throw new Error(
      "Matchmaking race smoke requires isolated rapid/classic pools with no unrelated queue rows.",
    );
  }
}

async function activeGameCount(playerKey: string) {
  const result = await query<GameCountRow>(
    `SELECT COUNT(*)::text AS active_games
       FROM games
      WHERE status = 'active'
        AND (black_player_key = $1 OR white_player_key = $1)`,
    [playerKey],
  );
  return Number(result.rows[0].active_games);
}

async function cleanup() {
  await query("DELETE FROM matchmaking_queue WHERE player_key = ANY($1::text[])", [playerKeys]);
  await query(
    `DELETE FROM games
      WHERE black_player_key = ANY($1::text[])
         OR white_player_key = ANY($1::text[])`,
    [playerKeys],
  );
}

async function waitUntilCancellationBlocks(publisherPid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity activity
          WHERE $1 = ANY(pg_blocking_pids(activity.pid))
       ) AS blocked`,
      [publisherPid],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Cancellation did not block on the contested queue row.");
}

async function verifyContestedCancellation() {
  await query(
    `INSERT INTO matchmaking_queue (
       player_key, board_size, time_control, rules_profile, status, game_id
     ) VALUES ($1, 9, 'rapid', 'chinese-2002-gostone-v1', 'waiting', NULL)`,
    [cancellationTarget],
  );
  const publisher = await getPool().connect();
  let committed = false;
  let cancellation: ReturnType<typeof cancelMatchmaking> | undefined;
  try {
    await publisher.query("BEGIN");
    await publisher.query("SET LOCAL statement_timeout = '8s'");
    const backend = await publisher.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await publisher.query(
      "SELECT player_key FROM matchmaking_queue WHERE player_key = $1 FOR UPDATE",
      [cancellationTarget],
    );
    const game = await publisher.query<{ id: string }>(
      `INSERT INTO games (
         board_size, black_player_key, white_player_key, time_control,
         rules, rules_profile, scoring_method, komi, handicap, phase, to_move,
         main_time_seconds, byo_yomi_periods, byo_yomi_seconds,
         black_time_remaining_ms, white_time_remaining_ms,
         black_periods_remaining, white_periods_remaining, turn_started_at
       ) VALUES (
         9, $1, $2, 'rapid',
         'chinese', 'chinese-2002-gostone-v1', 'area', 7.5, 0, 'play', 'black',
         900, 5, 30, 900000, 900000, 5, 5, NOW()
       ) RETURNING id`,
      [cancellationTarget, cancellationPeer],
    );
    await publisher.query(
      `UPDATE matchmaking_queue
          SET status = 'matched', game_id = $2, updated_at = NOW()
        WHERE player_key = $1`,
      [cancellationTarget, game.rows[0].id],
    );

    cancellation = cancelMatchmaking(cancellationTarget);
    await waitUntilCancellationBlocks(backend.rows[0].pid);
    await publisher.query("COMMIT");
    committed = true;

    const result = await cancellation;
    assert.equal(result.status, "matched");
    assert.equal(result.gameId, game.rows[0].id);
    assert.equal((await getMatchmakingStatus(cancellationTarget)).gameId, game.rows[0].id);
  } finally {
    if (!committed) await publisher.query("ROLLBACK");
    publisher.release();
    if (!committed && cancellation) await cancellation.catch(() => undefined);
  }
}

async function run() {
  await assertSmokeDatabaseIdentity(getPool());
  await assertIsolatedPools();
  await cleanup();
  try {
    await Promise.all([
      joinMatchmaking(simultaneous[0], 9, "rapid"),
      joinMatchmaking(simultaneous[1], 9, "rapid"),
    ]);
    const simultaneousStatuses = await Promise.all(
      simultaneous.map((playerKey) => getMatchmakingStatus(playerKey)),
    );
    assert.equal(simultaneousStatuses[0].status, "matched");
    assert.equal(simultaneousStatuses[1].status, "matched");
    assert.equal(simultaneousStatuses[0].gameId, simultaneousStatuses[1].gameId);

    const waitingOpponents = await Promise.all([
      joinMatchmaking(rapidOpponent, 9, "rapid"),
      joinMatchmaking(classicOpponent, 9, "classic"),
    ]);
    assert.deepEqual(waitingOpponents.map(({ status }) => status), ["waiting", "waiting"]);
    const repeatedResults = await Promise.all([
      joinMatchmaking(repeated, 9, "rapid"),
      joinMatchmaking(repeated, 9, "classic"),
    ]);
    assert.equal(repeatedResults[0].status, "matched");
    assert.equal(repeatedResults[1].status, "matched");
    assert.equal(repeatedResults[0].gameId, repeatedResults[1].gameId);
    assert.equal(await activeGameCount(repeated), 1);

    const cancellation = await cancelMatchmaking(repeated);
    assert.equal(cancellation.status, "matched");
    assert.equal(cancellation.gameId, repeatedResults[0].gameId);
    assert.equal((await getMatchmakingStatus(repeated)).gameId, repeatedResults[0].gameId);
    await verifyContestedCancellation();
    console.log("PostgreSQL matchmaking serialization smoke passed.");
  } finally {
    await cleanup();
  }
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Matchmaking race smoke failed.");
    process.exitCode = 1;
  })
  .finally(closePool);
