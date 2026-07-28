import "dotenv/config";
import assert from "node:assert/strict";
import { closePool, query } from "../lib/db";
import { isLocalDatabase } from "../lib/env";
import { EXPECTED_PLAYER_HEADER } from "../lib/auth/playerBinding";

const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
const databaseUrl = process.env.DATABASE_URL;
const smokeHost = new URL(baseUrl).hostname;

if (smokeHost !== "localhost" && smokeHost !== "127.0.0.1" && smokeHost !== "::1") {
  throw new Error("The clock smoke test only runs against an isolated local server.");
}
if (!databaseUrl || !isLocalDatabase(databaseUrl)) {
  throw new Error("The clock smoke test requires an isolated local DATABASE_URL.");
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed: ${response.status}`);
  return data;
}

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  cookie: string,
  expectedPlayerKey?: string,
): Promise<T> {
  return readJson<T>(
    await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(expectedPlayerKey
          ? { [EXPECTED_PLAYER_HEADER]: expectedPlayerKey }
          : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

async function createGuest() {
  const response = await fetch(`${baseUrl}/api/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await readJson<{
    identity: { playerKey: string };
  }>(response);
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return { cookie, playerKey: body.identity.playerKey };
}

async function run() {
  console.log(`Testing server-authoritative clock at ${baseUrl}`);
  const black = await createGuest();
  const white = await createGuest();
  await post("/api/matchmaking", {
    boardSize: 9,
    timeControl: "blitz",
  }, black.cookie, black.playerKey);
  const matched = await post<{
    actor: string;
    matchmaking: { gameId: string; timeControl: string };
  }>("/api/matchmaking", {
    boardSize: 9,
    timeControl: "blitz",
  }, white.cookie, white.playerKey);
  assert.equal(matched.actor, white.playerKey);
  const gameId = matched.matchmaking.gameId;
  assert.equal(matched.matchmaking.timeControl, "blitz");

  await query(
    `UPDATE games
        SET black_time_remaining_ms = 0,
            black_periods_remaining = 1,
            byo_yomi_seconds = 1,
            turn_started_at = NOW() - INTERVAL '2 seconds'
      WHERE id = $1`,
    [gameId],
  );

  const finished = await readJson<{
    game: {
      status: string;
      result: string;
      winnerKey: string;
      rated: boolean;
      clock: { black: { periodsRemaining: number } };
    };
  }>(
    await fetch(
      `${baseUrl}/api/games/${gameId}`,
      {
        cache: "no-store",
        headers: {
          Cookie: black.cookie,
          [EXPECTED_PLAYER_HEADER]: black.playerKey,
        },
      },
    ),
  );

  assert.equal(finished.game.status, "finished");
  assert.equal(finished.game.result, "W+T");
  assert.equal(finished.game.winnerKey, white.playerKey);
  assert.equal(finished.game.rated, false);
  assert.equal(finished.game.clock.black.periodsRemaining, 0);
  const ratingRows = await query<{ stats_count: number; history_count: number }>(
    `SELECT
       (SELECT COUNT(*)::int
          FROM player_stats
         WHERE player_key = ANY($2::text[]) AND board_size = 9) AS stats_count,
       (SELECT COUNT(*)::int
          FROM player_rating_history
         WHERE game_id = $1 AND player_key = ANY($2::text[])) AS history_count`,
    [gameId, [black.playerKey, white.playerKey]],
  );
  assert.deepEqual(ratingRows.rows[0], { stats_count: 0, history_count: 0 });
  console.log(`Clock flow passed for game ${gameId}.`);
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
