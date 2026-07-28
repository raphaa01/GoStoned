import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

async function request<T>(path: string, init?: RequestInit, cookie?: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const body = (await response.json()) as { ok: boolean; error?: string } & T;
  assert.equal(response.ok, true, `${path}: ${body.error ?? response.statusText}`);
  assert.equal(body.ok, true, `${path}: ${body.error ?? "request failed"}`);
  return body;
}

async function post<T>(path: string, body: object, cookie: string): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, cookie);
}

async function createGuest() {
  const response = await fetch(`${baseUrl}/api/auth/guest`, { method: "POST" });
  const body = (await response.json()) as {
    ok: boolean;
    error?: string;
    identity: { playerKey: string };
  };
  assert.equal(response.status, 201, body.error);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return { cookie, playerKey: body.identity.playerKey };
}

async function run() {
  console.log(`Testing live game flow at ${baseUrl}`);
  const black = await createGuest();
  const white = await createGuest();

  const cookieFree = await fetch(`${baseUrl}/api/matchmaking`);
  assert.equal(cookieFree.status, 401);
  const tampered = await fetch(`${baseUrl}/api/matchmaking`, {
    headers: { Cookie: "gostone_guest_session=tampered-token" },
  });
  assert.equal(tampered.status, 401);

  const first = await post<{ matchmaking: { status: string } }>("/api/matchmaking", {
    boardSize: 9,
    timeControl: "rapid",
  }, black.cookie);
  assert.equal(first.matchmaking.status, "waiting");

  const second = await post<{ matchmaking: { status: string; gameId: string } }>(
    "/api/matchmaking",
    { boardSize: 9, timeControl: "rapid" },
    white.cookie,
  );
  assert.equal(second.matchmaking.status, "matched");
  assert.ok(second.matchmaking.gameId);
  const gameId = second.matchmaking.gameId;

  const firstStatus = await request<{
    matchmaking: { status: string; gameId: string };
  }>("/api/matchmaking", undefined, black.cookie);
  assert.equal(firstStatus.matchmaking.gameId, gameId);

  const impersonationAttempt = await fetch(`${baseUrl}/api/games/${gameId}/moves`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: white.cookie },
    body: JSON.stringify({ playerKey: black.playerKey, x: 1, y: 1 }),
  });
  assert.equal(impersonationAttempt.status, 409);
  const impersonationBody = (await impersonationAttempt.json()) as { code?: string };
  assert.equal(impersonationBody.code, "not_your_turn");

  const blackMove = await post<{ game: { moveCount: number; turn: string } }>(
    `/api/games/${gameId}/moves`,
    { x: 2, y: 2 },
    black.cookie,
  );
  assert.equal(blackMove.game.moveCount, 1);
  assert.equal(blackMove.game.turn, "white");

  const whiteMove = await post<{ game: { moveCount: number; turn: string } }>(
    `/api/games/${gameId}/moves`,
    { x: 3, y: 2 },
    white.cookie,
  );
  assert.equal(whiteMove.game.moveCount, 2);
  assert.equal(whiteMove.game.turn, "black");

  await post(`/api/games/${gameId}/moves`, { isPass: true }, black.cookie);
  const finished = await post<{
    game: { status: string; result: string; moveCount: number };
  }>(`/api/games/${gameId}/moves`, { isPass: true }, white.cookie);
  assert.equal(finished.game.status, "finished");
  assert.equal(finished.game.moveCount, 4);
  assert.ok(finished.game.result);

  console.log(`Live game ${gameId} completed successfully (${finished.game.result}).`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
