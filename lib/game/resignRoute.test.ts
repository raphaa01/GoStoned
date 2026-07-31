import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { POST as resign } from "@/app/api/games/[gameId]/resign/route";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { SESSION_COOKIE } from "@/lib/auth/session";

test("resignation rejects a changed actor before game or rate-limit mutation", async () => {
  const statements: string[] = [];
  const previousPool = globalThis.goStonedDbPool;
  const pool = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("FROM user_sessions s")) {
        return {
          rows: [{
            id: "11111111-1111-4111-8111-111111111111",
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
  globalThis.goStonedDbPool = pool;
  globalThis.goStoneEphemeralRateLimits = new Map();
  try {
    const response = await resign(
      new NextRequest(
        "https://gostone.test/api/games/33333333-3333-4333-8333-333333333333/resign",
        {
          method: "POST",
          headers: {
            Cookie: `${SESSION_COOKIE}=${"a".repeat(43)}`,
            [EXPECTED_PLAYER_HEADER]: "user:22222222-2222-4222-8222-222222222222",
            "x-real-ip": "203.0.113.140",
          },
        },
      ),
      { params: Promise.resolve({ gameId: "33333333-3333-4333-8333-333333333333" }) },
    );

    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "identity_changed");
    assert.equal(statements.length, 1);
    assert.match(statements[0], /FROM user_sessions s/);
    assert.doesNotMatch(statements[0], /games|auth_rate_limits/);
  } finally {
    globalThis.goStonedDbPool = previousPool;
  }
});
