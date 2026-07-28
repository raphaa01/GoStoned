import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

type ApiBody = { ok: boolean; error?: string; [key: string]: unknown };

async function request(
  path: string,
  init?: RequestInit,
  expectedStatus = 200,
): Promise<{ body: ApiBody; cookie: string | null }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as ApiBody;
  assert.equal(
    response.status,
    expectedStatus,
    `${path}: expected ${expectedStatus}, received ${response.status} (${body.error ?? "no error"})`,
  );
  return {
    body,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null,
  };
}

function json(method: string, body: object, cookie?: string): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

async function run() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const firstUsername = `black_${suffix}`;
  const secondUsername = `white_${suffix}`;
  const password = "Test-password-42";

  console.log(`Testing account and chat flow at ${baseUrl}`);

  const registeredFirst = await request(
    "/api/auth/register",
    json("POST", { username: firstUsername, password }),
    201,
  );
  assert.equal(registeredFirst.body.ok, true);
  assert.ok(registeredFirst.cookie);
  const firstUser = registeredFirst.body.user as { id: string; playerKey: string; username: string };
  assert.equal(firstUser.username, firstUsername);

  const duplicate = await request(
    "/api/auth/register",
    json("POST", { username: firstUsername.toUpperCase(), password }),
    409,
  );
  assert.equal(duplicate.body.ok, false);

  const session = await request("/api/auth/session", {
    headers: { Cookie: registeredFirst.cookie! },
  });
  assert.equal((session.body.user as { id: string }).id, firstUser.id);

  await request(
    "/api/auth/logout",
    { method: "POST", headers: { Cookie: registeredFirst.cookie! } },
  );
  const endedSession = await request("/api/auth/session", {
    headers: { Cookie: registeredFirst.cookie! },
  });
  assert.equal(endedSession.body.user, null);

  const wrongLogin = await request(
    "/api/auth/login",
    json("POST", { username: firstUsername, password: "definitely-wrong" }),
    401,
  );
  assert.equal(wrongLogin.body.ok, false);

  const firstLogin = await request(
    "/api/auth/login",
    json("POST", { username: firstUsername, password }),
  );
  assert.ok(firstLogin.cookie);

  const registeredSecond = await request(
    "/api/auth/register",
    json("POST", { username: secondUsername, password }),
    201,
  );
  assert.ok(registeredSecond.cookie);

  const waiting = await request(
    "/api/matchmaking",
    json(
      "POST",
      { boardSize: 9, timeControl: "rapid" },
      firstLogin.cookie!,
    ),
  );
  assert.equal((waiting.body.matchmaking as { status: string }).status, "waiting");

  const matched = await request(
    "/api/matchmaking",
    json(
      "POST",
      { boardSize: 9, timeControl: "rapid" },
      registeredSecond.cookie!,
    ),
  );
  const gameId = (matched.body.matchmaking as { gameId: string }).gameId;
  assert.ok(gameId);

  const game = await request(
    `/api/games/${gameId}`,
    { headers: { Cookie: firstLogin.cookie! } },
  );
  assert.equal((game.body.game as { blackPlayerName: string }).blackPlayerName, firstUsername);

  await request(
    `/api/games/${gameId}/chat`,
    json("POST", { message: "Good luck!" }, firstLogin.cookie!),
    201,
  );
  await request(
    `/api/games/${gameId}/chat`,
    json("POST", { message: "Have fun!" }, registeredSecond.cookie!),
    201,
  );
  const blockedChat = await request(
    `/api/games/${gameId}/chat`,
    json(
      "POST",
      { message: "f.u.c.k" },
      firstLogin.cookie!,
    ),
    400,
  );
  assert.equal(blockedChat.body.code, "message_blocked");
  const chat = await request(
    `/api/games/${gameId}/chat`,
    { headers: { Cookie: firstLogin.cookie! } },
  );
  assert.deepEqual(
    (chat.body.messages as Array<{ message: string }>).map((message) => message.message),
    ["Good luck!", "Have fun!"],
  );

  await request(
    `/api/games/${gameId}/resign`,
    json("POST", {}, firstLogin.cookie!),
  );

  const firstProfile = await request("/api/profile", {
    headers: { Cookie: firstLogin.cookie! },
  });
  const firstStats = firstProfile.body.stats as Array<{
    boardSize: number;
    games: number;
    wins: number;
    losses: number;
    draws: number;
    rating: number;
    highestRating: number;
    ratingChange30Days: number;
  }>;
  const firstHistory = firstProfile.body.history as Array<{
    gameId: string;
    result: string;
    ratingBefore: number;
    ratingAfter: number;
    ratingChange: number;
  }>;
  const firstRecentGames = firstProfile.body.recentGames as Array<{
    gameId: string;
    result: string;
    ratingChange: number;
  }>;
  const firstGameHistory = firstHistory.find((entry) => entry.gameId === gameId);
  const firstBoardStat = firstStats.find((stat) => stat.boardSize === 9);
  assert.equal(firstBoardStat?.games, 1);
  assert.equal(firstBoardStat?.wins, 0);
  assert.equal(firstBoardStat?.losses, 1);
  assert.equal(firstBoardStat?.draws, 0);
  assert.equal(firstBoardStat?.rating, 1184);
  assert.equal(firstBoardStat?.highestRating, 1200);
  assert.equal(firstBoardStat?.ratingChange30Days, -16);
  assert.equal(firstGameHistory?.result, "loss");
  assert.equal(firstGameHistory?.ratingBefore, 1200);
  assert.equal(firstGameHistory?.ratingAfter, 1184);
  assert.equal(firstGameHistory?.ratingChange, -16);
  assert.equal(firstRecentGames[0].gameId, gameId);
  assert.equal(firstRecentGames[0].result, "loss");
  assert.equal(firstRecentGames[0].ratingChange, -16);

  const secondProfile = await request("/api/profile", {
    headers: { Cookie: registeredSecond.cookie! },
  });
  const secondHistory = secondProfile.body.history as Array<{
    gameId: string;
    result: string;
    ratingChange: number;
  }>;
  const secondGameHistory = secondHistory.find((entry) => entry.gameId === gameId);
  assert.equal(secondGameHistory?.result, "win");
  assert.equal(secondGameHistory?.ratingChange, 16);

  console.log(`Accounts, sessions, matchmaking, chat, rating history, and game ${gameId} passed.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
