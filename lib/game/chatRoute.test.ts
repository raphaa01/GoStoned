import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool, PoolClient } from "pg";
import {
  GET as readChat,
  POST as sendChat,
} from "@/app/api/games/[gameId]/chat/route";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { SESSION_COOKIE } from "@/lib/auth/session";

const gameId = "33333333-3333-4333-8333-333333333333";
const actor = "user:11111111-1111-4111-8111-111111111111";
const opponent = "guest:22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ gameId }) };

class ChatRoutePool {
  readonly blocks = new Set<string>();
  readonly statements: string[] = [];
  insertCount = 0;

  isBlocked() {
    return this.blocks.has(`${actor}\0${opponent}`)
      || this.blocks.has(`${opponent}\0${actor}`);
  }

  async connect() {
    return {
      query: this.transactionQuery.bind(this),
      release() {},
    } as unknown as PoolClient;
  }

  async query(sql: string) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.statements.push(normalized);
    if (normalized.includes("FROM user_sessions s")) {
      return {
        rows: [{
          id: actor.slice("user:".length),
          username: "route_actor",
          display_name: "Route Actor",
          expires_at: new Date(Date.now() + 60_000),
        }],
        rowCount: 1,
      };
    }
    if (normalized.includes("INSERT INTO auth_rate_limits")) {
      return {
        rows: [{
          attempts: 1,
          window_started_at: new Date(),
          blocked_until: null,
          retry_after_seconds: 60,
        }],
        rowCount: 1,
      };
    }
    if (normalized.startsWith("WITH participant AS") && normalized.includes("availability AS")) {
      return {
        rows: [{
          available: !this.isBlocked(),
          id: null,
          player_key: null,
          message: null,
          created_at: null,
          player_name: null,
        }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected pool query: ${normalized}`);
  }

  async transactionQuery(sql: string, values: readonly unknown[] = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.statements.push(normalized);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized) || normalized.startsWith("SET LOCAL")) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.includes("FROM games") && normalized.includes("$2 IN")) {
      return {
        rows: [{ black_player_key: actor, white_player_key: opponent }],
        rowCount: 1,
      };
    }
    if (normalized.includes("pg_advisory_xact_lock")) {
      return { rows: [{}], rowCount: 1 };
    }
    if (normalized.startsWith("SELECT (") && normalized.includes("FROM player_blocks")) {
      return { rows: [{ blocked: this.isBlocked() }], rowCount: 1 };
    }
    if (normalized.startsWith("WITH inserted AS")) {
      this.insertCount += 1;
      return {
        rows: [{
          id: "2",
          player_key: actor,
          message: String(values[2]),
          created_at: new Date("2026-01-01T00:00:00.000Z"),
          player_name: "Route Actor",
        }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected transaction query: ${normalized}`);
  }
}

async function withPool<T>(pool: ChatRoutePool, action: () => Promise<T>) {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = pool as unknown as Pool;
  globalThis.goStoneEphemeralRateLimits = new Map();
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previous;
  }
}

function request(
  method: "GET" | "POST",
  options: { url?: string; body?: string; origin?: string } = {},
) {
  return new NextRequest(
    options.url ?? `https://gostone.test/api/games/${gameId}/chat${method === "GET" ? "?after=0" : ""}`,
    {
      method,
      headers: {
        Cookie: `${SESSION_COOKIE}=${"a".repeat(43)}`,
        [EXPECTED_PLAYER_HEADER]: actor,
        "x-real-ip": "203.0.113.181",
        "sec-fetch-site": "same-origin",
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: options.body } : {}),
    },
  );
}

test("blocked chat route responses are identical in either direction and reveal no target", async (t) => {
  for (const direction of ["actor", "opponent"] as const) {
    await t.test(direction, async () => {
      const pool = new ChatRoutePool();
      pool.blocks.add(direction === "actor" ? `${actor}\0${opponent}` : `${opponent}\0${actor}`);

      const read = await withPool(pool, () => readChat(request("GET"), context));
      assert.equal(read.status, 200);
      assert.equal(read.headers.get("Cache-Control"), "no-store, max-age=0");
      assert.deepEqual(await read.json(), { ok: true, available: false, messages: [] });

      const send = await withPool(pool, () => sendChat(
        request("POST", { body: JSON.stringify({ message: "Hello" }) }),
        context,
      ));
      assert.equal(send.status, 409);
      assert.deepEqual(await send.json(), {
        ok: false,
        error: "Chat is unavailable for this game.",
        code: "chat_unavailable",
      });
      assert.equal(pool.insertCount, 0);
    });
  }
});

test("chat rejects non-canonical cursors, extra fields, and cross-origin sends", async () => {
  const cases: Array<{
    handler: typeof readChat | typeof sendChat;
    request: NextRequest;
    status: number;
  }> = [
    {
      handler: readChat,
      request: request("GET", {
        url: `https://gostone.test/api/games/${gameId}/chat?after=01`,
      }),
      status: 400,
    },
    {
      handler: readChat,
      request: request("GET", {
        url: `https://gostone.test/api/games/${gameId}/chat?after=0&target=${opponent}`,
      }),
      status: 400,
    },
    {
      handler: sendChat,
      request: request("POST", {
        body: JSON.stringify({ message: "Hello", target: opponent }),
      }),
      status: 400,
    },
    {
      handler: sendChat,
      request: request("POST", {
        body: JSON.stringify({ message: "Hello" }),
        origin: "https://attacker.test",
      }),
      status: 403,
    },
  ];

  for (const routeCase of cases) {
    const pool = new ChatRoutePool();
    const response = await withPool(pool, () => routeCase.handler(routeCase.request, context));
    assert.equal(response.status, routeCase.status);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.equal(pool.insertCount, 0);
  }
});

test("chat reads reject a stale displayed actor before rate or message access", async () => {
  const pool = new ChatRoutePool();
  const stale = request("GET");
  stale.headers.set(EXPECTED_PLAYER_HEADER, opponent);

  const response = await withPool(pool, () => readChat(stale, context));

  assert.equal(response.status, 409);
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal((await response.json()).code, "identity_changed");
  assert.equal(
    pool.statements.some((statement) => statement.includes("auth_rate_limits")),
    false,
  );
  assert.equal(
    pool.statements.some((statement) => statement.startsWith("WITH participant AS")),
    false,
  );
});
