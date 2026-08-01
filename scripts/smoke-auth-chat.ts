import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import { closePool, getPool } from "../lib/db";
import { isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { EXPECTED_PLAYER_HEADER } from "../lib/auth/playerBinding";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const databaseUrl = process.env.DATABASE_URL;
const smokeHost = new URL(baseUrl).hostname;

if (smokeHost !== "localhost" && smokeHost !== "127.0.0.1" && smokeHost !== "::1") {
  throw new Error("The auth/chat smoke test only runs against an isolated local server.");
}
if (!databaseUrl || !isUnambiguousLocalDatabase(databaseUrl)) {
  throw new Error("The auth/chat smoke test requires an isolated local DATABASE_URL.");
}

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

function json(
  method: string,
  body: object,
  cookie?: string,
  expectedPlayerKey?: string,
): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(expectedPlayerKey
        ? { [EXPECTED_PLAYER_HEADER]: expectedPlayerKey }
        : {}),
    },
    body: JSON.stringify(body),
  };
}

async function run() {
  await assertSmokeDatabaseIdentity(getPool());
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const firstUsername = `black_${suffix}`;
  const secondUsername = `white_${suffix}`;
  const password = "Test-password-42";

  console.log(`Testing account and chat flow at ${new URL(baseUrl).origin}`);

  const registeredFirst = await request(
    "/api/auth/register",
    json("POST", {
      username: firstUsername,
      password,
      startingStrength: "unspecified",
      knownRank: null,
    }),
    201,
  );
  assert.equal(registeredFirst.body.ok, true);
  assert.ok(registeredFirst.cookie);
  const firstUser = registeredFirst.body.user as { id: string; playerKey: string; username: string };
  assert.equal(firstUser.username, firstUsername);

  const duplicate = await request(
    "/api/auth/register",
    json("POST", {
      username: firstUsername.toUpperCase(),
      password,
      startingStrength: "unspecified",
      knownRank: null,
    }),
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

  const firstLogin = await request(
    "/api/auth/login",
    json("POST", { username: firstUsername, password }),
  );
  assert.ok(firstLogin.cookie);

  // Keep the deliberate failure after the valid login: a failed attempt correctly
  // activates the per-account burst window for an immediate retry.
  const wrongLogin = await request(
    "/api/auth/login",
    json("POST", { username: firstUsername, password: "definitely-wrong" }),
    401,
  );
  assert.equal(wrongLogin.body.ok, false);

  const registeredSecond = await request(
    "/api/auth/register",
    json("POST", {
      username: secondUsername,
      password,
      startingStrength: "unspecified",
      knownRank: null,
    }),
    201,
  );
  assert.ok(registeredSecond.cookie);
  const secondUser = registeredSecond.body.user as { playerKey: string };

  const waiting = await request(
    "/api/matchmaking",
    json(
      "POST",
      { boardSize: 9, timeControl: "rapid" },
      firstLogin.cookie!,
      firstUser.playerKey,
    ),
  );
  assert.equal((waiting.body.matchmaking as { status: string }).status, "waiting");

  const matched = await request(
    "/api/matchmaking",
    json(
      "POST",
      { boardSize: 9, timeControl: "rapid" },
      registeredSecond.cookie!,
      secondUser.playerKey,
    ),
  );
  assert.equal(waiting.body.actor, firstUser.playerKey);
  assert.equal(matched.body.actor, secondUser.playerKey);
  const gameId = (matched.body.matchmaking as { gameId: string }).gameId;
  assert.ok(gameId);

  const game = await request(
    `/api/games/${gameId}`,
    {
      headers: {
        Cookie: firstLogin.cookie!,
        [EXPECTED_PLAYER_HEADER]: firstUser.playerKey,
      },
    },
  );
  assert.equal((game.body.game as { blackPlayerName: string }).blackPlayerName, firstUsername);

  await request(
    `/api/games/${gameId}/chat`,
    json("POST", { message: "Good luck!" }, firstLogin.cookie!, firstUser.playerKey),
    201,
  );
  const secondMessage = await request(
    `/api/games/${gameId}/chat`,
    json("POST", { message: "Have fun!" }, registeredSecond.cookie!, secondUser.playerKey),
    201,
  );
  assert.equal(secondMessage.body.actor, secondUser.playerKey);
  const blockedChat = await request(
    `/api/games/${gameId}/chat`,
    json(
      "POST",
      { message: "f.u.c.k" },
      firstLogin.cookie!,
      firstUser.playerKey,
    ),
    400,
  );
  assert.equal(blockedChat.body.code, "message_blocked");
  const chat = await request(
    `/api/games/${gameId}/chat`,
    {
      headers: {
        Cookie: firstLogin.cookie!,
        [EXPECTED_PLAYER_HEADER]: firstUser.playerKey,
      },
    },
  );
  assert.deepEqual(
    (chat.body.messages as Array<{ message: string }>).map((message) => message.message),
    ["Good luck!", "Have fun!"],
  );

  const resigned = await request(
    `/api/games/${gameId}/resign`,
    {
      method: "POST",
      headers: {
        Cookie: firstLogin.cookie!,
        [EXPECTED_PLAYER_HEADER]: firstUser.playerKey,
      },
    },
  );
  assert.equal((resigned.body.game as { rated: boolean }).rated, true);

  const firstProfile = await request("/api/profile", {
    headers: { Cookie: firstLogin.cookie! },
  });
  const firstRating = firstProfile.body.rating as {
    rating: number;
    ratingDeviation: number;
    ratedGameCount: number;
    isProvisional: boolean;
    algorithmVersion: string;
    highestRating: number;
    ratingChange30Days: number;
  };
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
    rated: boolean;
  }>;
  const firstGameHistory = firstHistory.find((entry) => entry.gameId === gameId);
  assert.equal(firstRating.ratedGameCount, 1);
  assert.equal(firstRating.isProvisional, true);
  assert.equal(firstRating.algorithmVersion, "glicko2-v1-tau-0.5");
  assert.ok(firstRating.rating < 1200);
  assert.ok(firstRating.ratingDeviation > 0 && firstRating.ratingDeviation < 350);
  assert.equal(firstRating.highestRating, firstRating.rating);
  assert.ok(firstRating.ratingChange30Days < 0);
  assert.equal(firstGameHistory?.result, "loss");
  assert.equal(firstGameHistory?.ratingBefore, 1200);
  assert.equal(firstGameHistory?.ratingAfter, firstRating.rating);
  assert.equal(firstGameHistory?.ratingChange, firstRating.ratingChange30Days);
  assert.equal(firstRecentGames[0].gameId, gameId);
  assert.equal(firstRecentGames[0].result, "loss");
  assert.equal(firstRecentGames[0].ratingChange, firstGameHistory?.ratingChange);
  assert.equal(firstRecentGames[0].rated, true);

  const storedGame = await request(`/api/games/${gameId}`, {
    headers: {
      Cookie: firstLogin.cookie!,
      [EXPECTED_PLAYER_HEADER]: firstUser.playerKey,
    },
  });
  assert.equal((storedGame.body.game as { rated: boolean }).rated, true);

  const secondProfile = await request("/api/profile", {
    headers: { Cookie: registeredSecond.cookie! },
  });
  const secondRating = secondProfile.body.rating as {
    rating: number;
    ratingDeviation: number;
    ratedGameCount: number;
    isProvisional: boolean;
    algorithmVersion: string;
    ratingChange30Days: number;
  };
  const secondHistory = secondProfile.body.history as Array<{
    gameId: string;
    result: string;
    ratingBefore: number;
    ratingAfter: number;
    ratingChange: number;
  }>;
  const secondGameHistory = secondHistory.find((entry) => entry.gameId === gameId);
  assert.equal(secondRating.ratedGameCount, 1);
  assert.equal(secondRating.isProvisional, true);
  assert.equal(secondRating.algorithmVersion, "glicko2-v1-tau-0.5");
  assert.ok(secondRating.rating > 1200);
  assert.equal(secondRating.ratingDeviation, firstRating.ratingDeviation);
  assert.equal(secondRating.ratingChange30Days, secondRating.rating - 1200);
  assert.equal(secondGameHistory?.result, "win");
  assert.equal(secondGameHistory?.ratingBefore, 1200);
  assert.equal(secondGameHistory?.ratingAfter, secondRating.rating);
  assert.equal(secondGameHistory?.ratingChange, secondRating.ratingChange30Days);

  const events = await getPool().query<{
    player_key: string;
    outcome_kind: string;
    opponent_kind: string;
    algorithm_version: string;
  }>(
    `SELECT player_key,outcome_kind,opponent_kind,algorithm_version
       FROM game_glicko2_rating_events
      WHERE game_id=$1
      ORDER BY player_key`,
    [gameId],
  );
  assert.equal(events.rowCount, 2);
  assert.deepEqual(
    new Set(events.rows.map(({ player_key }) => player_key)),
    new Set([firstUser.playerKey, secondUser.playerKey]),
  );
  assert.deepEqual(
    events.rows.map(({ outcome_kind }) => outcome_kind).sort(),
    ["loss", "win"],
  );
  assert.ok(events.rows.every(({ opponent_kind }) => opponent_kind === "registered_human"));
  assert.ok(events.rows.every(
    ({ algorithm_version }) => algorithm_version === "glicko2-v1-tau-0.5",
  ));

  console.log(`Accounts, sessions, matchmaking, chat, global ratings, and game ${gameId} passed.`);
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Auth/chat smoke failed.");
    process.exitCode = 1;
  })
  .finally(closePool);
