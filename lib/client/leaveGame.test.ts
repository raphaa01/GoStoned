import assert from "node:assert/strict";
import test from "node:test";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { ApiRequestError } from "./api";
import { leaveGameAndQueue } from "./leaveGame";

const playerKey = "guest:11111111-1111-4111-8111-111111111111";
const gameId = "22222222-2222-4222-8222-222222222222";

function apiResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return Response.json(body, { status });
}

test("changed resignation authority stops before matchmaking cancellation", async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return apiResponse({
      ok: false,
      error: "The player session changed.",
      code: "identity_changed",
    }, 409);
  };
  try {
    await assert.rejects(
      leaveGameAndQueue(gameId, playerKey),
      (error) => error instanceof ApiRequestError && error.code === "identity_changed",
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, `/api/games/${gameId}/resign`);
    assert.equal(
      new Headers(calls[0].init?.headers).get(EXPECTED_PLAYER_HEADER),
      playerKey,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("an already-finished game continues to authoritative idle cancellation", async () => {
  const previousFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async (_input, init) => {
    call += 1;
    assert.equal(new Headers(init?.headers).get(EXPECTED_PLAYER_HEADER), playerKey);
    if (call === 1) {
      return apiResponse({
        ok: false,
        error: "This game is already finished.",
        code: "game_finished",
      }, 409);
    }
    return apiResponse({
      ok: true,
      actor: playerKey,
      matchmaking: {
        status: "idle",
        gameId: null,
        boardSize: null,
        timeControl: null,
      },
    });
  };
  try {
    assert.deepEqual(await leaveGameAndQueue(gameId, playerKey), { kind: "left" });
    assert.equal(call, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("an authoritative matched cancellation preserves the active game", async () => {
  const previousFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 1) {
      return apiResponse({ ok: true, actor: playerKey, game: { id: gameId } });
    }
    return apiResponse({
      ok: true,
      actor: playerKey,
      matchmaking: {
        status: "matched",
        gameId,
        boardSize: 13,
        timeControl: "classic",
      },
    });
  };
  try {
    assert.deepEqual(await leaveGameAndQueue(gameId, playerKey), {
      kind: "active",
      gameId,
      boardSize: 13,
      timeControl: "classic",
    });
    assert.equal(call, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
