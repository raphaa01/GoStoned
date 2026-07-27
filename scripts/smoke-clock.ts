import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closePool, query } from "../lib/db";

const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
const blackPlayer = `guest:${randomUUID()}`;
const whitePlayer = `guest:${randomUUID()}`;

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed: ${response.status}`);
  return data;
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return readJson<T>(
    await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function run() {
  console.log(`Testing server-authoritative clock at ${baseUrl}`);
  await post("/api/matchmaking", {
    playerKey: blackPlayer,
    boardSize: 9,
    timeControl: "blitz",
  });
  const matched = await post<{
    matchmaking: { gameId: string; timeControl: string };
  }>("/api/matchmaking", {
    playerKey: whitePlayer,
    boardSize: 9,
    timeControl: "blitz",
  });
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
      `${baseUrl}/api/games/${gameId}?playerKey=${encodeURIComponent(blackPlayer)}`,
      { cache: "no-store" },
    ),
  );

  assert.equal(finished.game.status, "finished");
  assert.equal(finished.game.result, "W+T");
  assert.equal(finished.game.winnerKey, whitePlayer);
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
