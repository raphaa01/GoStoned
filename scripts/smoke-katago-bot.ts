import assert from "node:assert/strict";
import "dotenv/config";
import { EXPECTED_PLAYER_HEADER } from "../lib/auth/playerBinding";
import { closePool, getPool, query } from "../lib/db";
import { isUnambiguousLocalDatabase } from "../lib/env";
import type { GameState } from "../lib/game/types";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const databaseUrl = process.env.DATABASE_URL;
const smokeHost = new URL(baseUrl).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(smokeHost)) {
  throw new Error("The KataGo bot smoke test only runs against a local server.");
}
if (!databaseUrl || !isUnambiguousLocalDatabase(databaseUrl)) {
  throw new Error("The KataGo bot smoke test requires an isolated local DATABASE_URL.");
}

type Identity = { cookie: string; playerKey: string };

async function api<T>(
  path: string,
  identity: Identity,
  init: RequestInit = {},
): Promise<T> {
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

async function readGame(gameId: string, identity: Identity): Promise<GameState> {
  return (await api<{ game: GameState }>(`/api/games/${gameId}`, identity)).game;
}

async function waitForGame(
  gameId: string,
  identity: Identity,
  predicate: (game: GameState) => boolean,
  timeoutMs = 90_000,
): Promise<GameState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const game = await readGame(gameId, identity);
    if (predicate(game)) return game;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("Timed out waiting for the KataGo bot move.");
}

function nearestEmptyMove(game: GameState): { x: number; y: number } {
  const center = (game.boardSize - 1) / 2;
  let best: { x: number; y: number; distance: number } | null = null;
  for (let y = 0; y < game.boardSize; y += 1) {
    for (let x = 0; x < game.boardSize; x += 1) {
      if (game.board[y][x] !== null) continue;
      const distance = Math.abs(x - center) + Math.abs(y - center);
      if (!best || distance < best.distance) best = { x, y, distance };
    }
  }
  if (!best) throw new Error("The smoke game has no empty intersection.");
  return { x: best.x, y: best.y };
}

async function run() {
  await assertSmokeDatabaseIdentity(getPool());
  const existingPool = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM matchmaking_queue
      WHERE status = 'waiting' AND board_size = 9 AND time_control = 'classic'`,
  );
  assert.equal(existingPool.rows[0]?.count, "0", "The 9×9 classic smoke pool must be empty.");

  const identity = await createGuest();
  let gameId: string | null = null;
  let matchedAfterMs = 0;
  try {
    const joinedAt = Date.now();
    const joined = await api<{ matchmaking: { status: string } }>(
      "/api/matchmaking",
      identity,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardSize: 9, timeControl: "classic" }),
      },
    );
    assert.equal(joined.matchmaking.status, "waiting");

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !gameId) {
      const status = await api<{ matchmaking: { status: string; gameId: string | null } }>(
        "/api/matchmaking",
        identity,
      );
      if (status.matchmaking.status === "matched") {
        gameId = status.matchmaking.gameId;
        matchedAfterMs = Date.now() - joinedAt;
      }
      if (!gameId) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(gameId, "No KataGo bot match was created.");
    assert.ok(matchedAfterMs >= 9_500, "Bot fallback matched before ten seconds.");

    let game = await readGame(gameId, identity);
    assert.equal(game.rated, false);
    assert.equal(Boolean(game.blackPlayerIsBot) !== Boolean(game.whitePlayerIsBot), true);
    const botKey = game.blackPlayerIsBot ? game.blackPlayerKey : game.whitePlayerKey;
    assert.match(botKey, /^bot:[0-9a-f-]{36}$/);
    const botName = game.blackPlayerIsBot ? game.blackPlayerName : game.whitePlayerName;
    assert.ok(botName.length >= 2 && !botName.toLowerCase().includes("guest"));

    const humanColor = game.blackPlayerKey === identity.playerKey ? "black" : "white";
    const initialBotStartedAt = Date.now();
    game = await waitForGame(gameId, identity, (current) => current.turn === humanColor);
    const initialBotMoveMs = game.moveCount > 0 ? Date.now() - initialBotStartedAt : null;
    if (initialBotMoveMs !== null) {
      assert.ok(initialBotMoveMs <= 10_500, `Initial bot move took ${initialBotMoveMs}ms.`);
    }
    const beforeHumanMove = game.moveCount;
    const humanMove = nearestEmptyMove(game);
    const moveResponse = await api<{ game: GameState }>(
      `/api/games/${gameId}/moves`,
      identity,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...humanMove, expectedVersion: game.version }),
      },
    );
    assert.equal(moveResponse.game.moveCount, beforeHumanMove + 1);
    const replyStartedAt = Date.now();
    const afterBot = await waitForGame(
      gameId,
      identity,
      (current) => current.moveCount >= beforeHumanMove + 2 || current.status === "finished",
    );
    const botReplyMs = Date.now() - replyStartedAt;
    assert.ok(afterBot.moveCount >= beforeHumanMove + 2, "KataGo did not answer the human move.");
    assert.ok(botReplyMs <= 10_500, `Bot reply took ${botReplyMs}ms.`);
    console.log(JSON.stringify({
      ok: true,
      fallbackMs: matchedAfterMs,
      gameId,
      botName,
      botColor: game.blackPlayerIsBot ? "black" : "white",
      botReplyMs,
      moveCount: afterBot.moveCount,
    }));
  } finally {
    if (gameId) {
      const game = await readGame(gameId, identity).catch(() => null);
      if (game?.status === "active") {
        await api(`/api/games/${gameId}/resign`, identity, { method: "POST" }).catch(() => undefined);
      }
    }
    await api("/api/matchmaking", identity, { method: "DELETE" }).catch(() => undefined);
  }
}

run()
  .finally(() => closePool())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
