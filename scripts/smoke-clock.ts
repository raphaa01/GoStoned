import "dotenv/config";
import assert from "node:assert/strict";
import { closePool, query } from "../lib/db";
import { isLocalDatabase } from "../lib/env";

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
): Promise<T> {
  return readJson<T>(
    await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    }),
  );
}

async function createGuest() {
  const response = await fetch(`${baseUrl}/api/auth/guest`, { method: "POST" });
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
  }, black.cookie);
  const matched = await post<{
    matchmaking: { gameId: string; timeControl: string };
  }>("/api/matchmaking", {
    boardSize: 9,
    timeControl: "blitz",
  }, white.cookie);
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
      clock: { black: { periodsRemaining: number } };
    };
  }>(
    await fetch(
      `${baseUrl}/api/games/${gameId}`,
      { cache: "no-store", headers: { Cookie: black.cookie } },
    ),
  );

  assert.equal(finished.game.status, "finished");
  assert.equal(finished.game.result, "W+T");
  assert.equal(finished.game.winnerKey, white.playerKey);
  assert.equal(finished.game.clock.black.periodsRemaining, 0);
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
