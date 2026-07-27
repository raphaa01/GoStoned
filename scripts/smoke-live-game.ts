import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const blackPlayer = `guest:${randomUUID()}`;
const whitePlayer = `guest:${randomUUID()}`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as { ok: boolean; error?: string } & T;
  assert.equal(response.ok, true, `${path}: ${body.error ?? response.statusText}`);
  assert.equal(body.ok, true, `${path}: ${body.error ?? "request failed"}`);
  return body;
}

async function post<T>(path: string, body: object): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function run() {
  console.log(`Testing live game flow at ${baseUrl}`);

  const first = await post<{ matchmaking: { status: string } }>("/api/matchmaking", {
    playerKey: blackPlayer,
    boardSize: 9,
    timeControl: "rapid",
  });
  assert.equal(first.matchmaking.status, "waiting");

  const second = await post<{ matchmaking: { status: string; gameId: string } }>(
    "/api/matchmaking",
    { playerKey: whitePlayer, boardSize: 9, timeControl: "rapid" },
  );
  assert.equal(second.matchmaking.status, "matched");
  assert.ok(second.matchmaking.gameId);
  const gameId = second.matchmaking.gameId;

  const firstStatus = await request<{
    matchmaking: { status: string; gameId: string };
  }>(`/api/matchmaking?playerKey=${encodeURIComponent(blackPlayer)}`);
  assert.equal(firstStatus.matchmaking.gameId, gameId);

  const blackMove = await post<{ game: { moveCount: number; turn: string } }>(
    `/api/games/${gameId}/moves`,
    { playerKey: blackPlayer, x: 2, y: 2 },
  );
  assert.equal(blackMove.game.moveCount, 1);
  assert.equal(blackMove.game.turn, "white");

  const whiteMove = await post<{ game: { moveCount: number; turn: string } }>(
    `/api/games/${gameId}/moves`,
    { playerKey: whitePlayer, x: 3, y: 2 },
  );
  assert.equal(whiteMove.game.moveCount, 2);
  assert.equal(whiteMove.game.turn, "black");

  await post(`/api/games/${gameId}/moves`, { playerKey: blackPlayer, isPass: true });
  const finished = await post<{
    game: { status: string; result: string; moveCount: number };
  }>(`/api/games/${gameId}/moves`, { playerKey: whitePlayer, isPass: true });
  assert.equal(finished.game.status, "finished");
  assert.equal(finished.game.moveCount, 4);
  assert.ok(finished.game.result);

  console.log(`Live game ${gameId} completed successfully (${finished.game.result}).`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
