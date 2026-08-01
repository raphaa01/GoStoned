import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { POST as submitBotMove } from "@/app/api/games/[gameId]/bot-move/route";
import { POST as sendChat } from "@/app/api/games/[gameId]/chat/route";
import { POST as submitMove } from "@/app/api/games/[gameId]/moves/route";
import { POST as resign } from "@/app/api/games/[gameId]/resign/route";
import { POST as confirmScore } from "@/app/api/games/[gameId]/scoring/confirm/route";
import { POST as markDead } from "@/app/api/games/[gameId]/scoring/dead-stones/route";
import { POST as resumePlay } from "@/app/api/games/[gameId]/scoring/resume/route";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { SESSION_COOKIE } from "@/lib/auth/session";

const gameId = "33333333-3333-4333-8333-333333333333";
const authenticatedPlayer = "user:11111111-1111-4111-8111-111111111111";
const displayedPlayer = "guest:22222222-2222-4222-8222-222222222222";

type MutationHandler = (
  request: NextRequest,
  context: { params: Promise<{ gameId: string }> },
) => Promise<Response>;

const mutations: Array<{ name: string; path: string; handler: MutationHandler }> = [
  { name: "verified local bot move", path: "bot-move", handler: submitBotMove },
  { name: "move", path: "moves", handler: submitMove },
  { name: "chat send", path: "chat", handler: sendChat },
  { name: "dead-stone edit", path: "scoring/dead-stones", handler: markDead },
  { name: "score confirmation", path: "scoring/confirm", handler: confirmScore },
  { name: "scoring resume", path: "scoring/resume", handler: resumePlay },
  { name: "resignation", path: "resign", handler: resign },
];

test("every game mutation rejects a changed actor before rate or game writes", async (t) => {
  const previousPool = globalThis.goStonedDbPool;
  try {
    for (const mutation of mutations) {
      await t.test(mutation.name, async () => {
        const statements: string[] = [];
        globalThis.goStoneEphemeralRateLimits = new Map();
        globalThis.goStonedDbPool = {
          async query(sql: string) {
            statements.push(sql);
            if (sql.includes("FROM user_sessions s")) {
              return {
                rows: [{
                  id: authenticatedPlayer.slice("user:".length),
                  username: "current_player",
                  display_name: "Current Player",
                  expires_at: new Date(Date.now() + 60_000),
                }],
                rowCount: 1,
              };
            }
            throw new Error(`Unexpected statement: ${sql}`);
          },
        } as unknown as Pool;

        const response = await mutation.handler(
          new NextRequest(`https://gostone.test/api/games/${gameId}/${mutation.path}`, {
            method: "POST",
            headers: {
              ...(mutation.name === "resignation" ? {} : {
                "Content-Type": "application/json",
              }),
              Cookie: `${SESSION_COOKIE}=${"a".repeat(43)}`,
              [EXPECTED_PLAYER_HEADER]: displayedPlayer,
              "x-real-ip": "203.0.113.141",
            },
            ...(mutation.name === "resignation" ? {} : { body: "{}" }),
          }),
          { params: Promise.resolve({ gameId }) },
        );

        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, "identity_changed");
        assert.equal(statements.length, 1);
        assert.match(statements[0], /FROM user_sessions s/);
        assert.doesNotMatch(
          statements[0],
          /auth_rate_limits|games|moves|game_messages|game_scoring_state|player_rating/i,
        );
      });
    }
  } finally {
    globalThis.goStonedDbPool = previousPool;
  }
});
