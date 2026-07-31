import assert from "node:assert/strict";
import "dotenv/config";
import { EXPECTED_PLAYER_HEADER } from "../lib/auth/playerBinding";
import { closePool, getPool, query } from "../lib/db";
import { isUnambiguousLocalDatabase } from "../lib/env";
import type { PuzzleAttemptResult, PuzzleHub } from "../lib/puzzles/types";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const databaseUrl = process.env.DATABASE_URL;
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(baseUrl).hostname)) {
  throw new Error("The KataGo puzzle smoke test only runs against a local server.");
}
if (!databaseUrl || !isUnambiguousLocalDatabase(databaseUrl)) {
  throw new Error("The KataGo puzzle smoke test requires an isolated local DATABASE_URL.");
}

type Identity = { cookie: string; playerKey: string };

async function createGuest(): Promise<Identity> {
  const response = await fetch(`${baseUrl}/api/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await response.json() as {
    ok: boolean;
    error?: string;
    identity: { playerKey: string };
  };
  assert.equal(response.status, 201, body.error);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return { cookie, playerKey: body.identity.playerKey };
}

async function api<T>(path: string, identity: Identity, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Cookie: identity.cookie,
      [EXPECTED_PLAYER_HEADER]: identity.playerKey,
    },
  });
  const body = await response.json() as { ok: boolean; error?: string } & T;
  assert.equal(response.ok, true, `${path}: ${body.error ?? response.statusText}`);
  assert.equal(body.ok, true, `${path}: ${body.error ?? "request failed"}`);
  return body;
}

async function run() {
  await assertSmokeDatabaseIdentity(getPool());
  const identity = await createGuest();
  const daily = await api<PuzzleHub>("/api/puzzles?mode=daily", identity);
  assert.equal(daily.status, "ready");
  const puzzle = daily.puzzles[0];
  assert.ok(puzzle);
  assert.equal(puzzle.solution, null, "An unsolved API response exposed the answer.");

  const stored = await query<{ solution_x: number; solution_y: number }>(
    "SELECT solution_x, solution_y FROM puzzles WHERE id = $1",
    [puzzle.id],
  );
  const answer = stored.rows[0];
  assert.ok(answer);
  const attempted = await api<{ attempt: PuzzleAttemptResult }>(
    `/api/puzzles/${puzzle.id}/attempt`,
    identity,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: answer.solution_x, y: answer.solution_y }),
    },
  );
  assert.equal(attempted.attempt.correct, true);
  assert.equal(attempted.attempt.solved, true);
  assert.ok(attempted.attempt.solution);

  const solved = await api<PuzzleHub>("/api/puzzles?mode=daily", identity);
  assert.equal(solved.puzzles[0]?.solved, true);
  assert.ok(solved.puzzles[0]?.solution);
  const practice = await api<PuzzleHub>("/api/puzzles?mode=practice", identity);
  assert.equal(practice.status, "ready");
  assert.ok(practice.puzzles.length >= 1);
  assert.ok(practice.puzzles.every((entry) => entry.solution === null));

  console.log(JSON.stringify({
    ok: true,
    dailyPuzzleId: puzzle.id,
    dailyBoardSize: puzzle.boardSize,
    practiceCount: practice.puzzles.length,
  }));
}

run()
  .finally(() => closePool())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
