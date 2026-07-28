import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import {
  DELETE as cancelMatchmaking,
  POST as joinMatchmaking,
} from "@/app/api/matchmaking/route";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import {
  assertMatchmakingMutationMetadata,
  MAX_MATCHMAKING_MUTATION_BODY_BYTES,
  readMatchmakingJoinRequest,
} from "./matchmakingMutationRequest";

type Statement = { sql: string; values: readonly unknown[] };

async function withPool<T>(pool: Pool, action: () => Promise<T>) {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = pool;
  globalThis.goStoneEphemeralRateLimits = new Map();
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previous;
  }
}

function request(
  body: BodyInit | null,
  authenticated = true,
  method = "POST",
  options: {
    contentType?: string;
    origin?: string;
    secFetchSite?: string;
    url?: string;
  } = {},
) {
  return new NextRequest(options.url ?? "https://gostone.test/api/matchmaking", {
    method,
    headers: {
      "x-real-ip": "203.0.113.120",
      "sec-fetch-site": options.secFetchSite ?? "same-origin",
      [EXPECTED_PLAYER_HEADER]: "user:11111111-1111-4111-8111-111111111111",
      ...(authenticated ? { Cookie: `${SESSION_COOKIE}=${"a".repeat(43)}` } : {}),
      ...(body === null ? {} : {
        "Content-Type": options.contentType ?? "application/json",
      }),
      ...(options.origin ? { Origin: options.origin } : {}),
    },
    ...(body === null ? {} : { body }),
  });
}

function matchedCancellationPool() {
  const statements: Statement[] = [];
  const gameId = "22222222-2222-4222-8222-222222222222";
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (
        normalized === "BEGIN"
        || normalized === "COMMIT"
        || normalized === "ROLLBACK"
        || normalized.startsWith("SET LOCAL")
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("FROM matchmaking_queue q") && normalized.includes("FOR UPDATE OF q")) {
        return {
          rows: [{
            player_key: "user:route_player",
            board_size: 9,
            time_control: "rapid",
            rules_profile: "chinese-2002-gostone-v1",
            status: "matched",
            game_id: gameId,
            created_at: new Date(),
            is_stale: false,
          }],
          rowCount: 1,
        };
      }
      if (normalized === "SELECT status FROM games WHERE id = $1") {
        return { rows: [{ status: "active" }], rowCount: 1 };
      }
      throw new Error(`Unexpected transaction query: ${normalized}`);
    },
    release() {},
  };
  let rateLimitWrites = 0;
  const pool = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("FROM user_sessions s")) {
        return {
          rows: [{
            id: "11111111-1111-4111-8111-111111111111",
            username: "route_player",
            display_name: "Route Player",
            expires_at: new Date(Date.now() + 60_000),
          }],
        };
      }
      if (sql.includes("INSERT INTO auth_rate_limits")) {
        rateLimitWrites += 1;
        return {
          rows: [{
            attempts: 1,
            window_started_at: new Date(),
            blocked_until: null,
            retry_after_seconds: 60,
          }],
        };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return client;
    },
  } as unknown as Pool;
  return { pool, statements, gameId, getRateLimitWrites: () => rateLimitWrites };
}

function authenticatedPool(
  onRateLimit: (writeNumber: number) => object = () => ({
    rows: [{
      attempts: 1,
      window_started_at: new Date(),
      blocked_until: null,
      retry_after_seconds: 60,
    }],
  }),
) {
  const statements: Statement[] = [];
  let rateLimitWrites = 0;
  const pool = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("FROM user_sessions s")) {
        return {
          rows: [{
            id: "11111111-1111-4111-8111-111111111111",
            username: "route_player",
            display_name: "Route Player",
            expires_at: new Date(Date.now() + 60_000),
          }],
        };
      }
      if (sql.includes("INSERT INTO auth_rate_limits")) {
        rateLimitWrites += 1;
        return onRateLimit(rateLimitWrites);
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as Pool;
  return { pool, statements };
}

test("matchmaking mutation metadata is rejected before identity or database access", async (t) => {
  const mutations = [
    {
      name: "join",
      method: "POST",
      body: JSON.stringify({ boardSize: 9, timeControl: "rapid" }),
      handler: joinMatchmaking,
    },
    {
      name: "cancel",
      method: "DELETE",
      body: null,
      handler: cancelMatchmaking,
    },
  ] as const;

  for (const mutation of mutations) {
    await t.test(mutation.name, async () => {
      const cases = [
        {
          expectedStatus: 403,
          expectedCode: "request_rejected",
          request: request(mutation.body, true, mutation.method, {
            origin: "https://attacker.test",
          }),
        },
        {
          expectedStatus: 403,
          expectedCode: "request_rejected",
          request: request(mutation.body, true, mutation.method, {
            origin: "not a valid origin",
          }),
        },
        {
          expectedStatus: 403,
          expectedCode: "request_rejected",
          request: request(mutation.body, true, mutation.method, {
            secFetchSite: "cross-site",
          }),
        },
        {
          expectedStatus: 400,
          expectedCode: "invalid_matchmaking_request",
          request: request(mutation.body, true, mutation.method, {
            url: "https://gostone.test/api/matchmaking?unsupported=1",
          }),
        },
        ...(mutation.method === "POST" ? [
          {
            expectedStatus: 403,
            expectedCode: "request_rejected",
            request: request(mutation.body, true, mutation.method, {
              contentType: "text/plain",
            }),
          },
          {
            expectedStatus: 403,
            expectedCode: "request_rejected",
            request: request(null, true, mutation.method),
          },
        ] : [{
          expectedStatus: 400,
          expectedCode: "invalid_matchmaking_request",
          request: request("{}", true, mutation.method),
        }]),
      ];

      for (const invalid of cases) {
        const { pool, statements } = authenticatedPool();
        const response = await withPool(pool, () => mutation.handler(invalid.request));
        assert.equal(response.status, invalid.expectedStatus);
        assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
        assert.equal(response.headers.get("set-cookie"), null);
        assert.equal((await response.json()).code, invalid.expectedCode);
        assert.equal(statements.length, 0);
      }
    });
  }
});

test("malformed and invalid matchmaking bodies return a metered 400", async () => {
  for (const body of [
    "",
    "{",
    "null",
    "[]",
    "1",
    JSON.stringify("rapid"),
    JSON.stringify({ boardSize: 9 }),
    JSON.stringify({ boardSize: 9, timeControl: "rapid", extra: true }),
    JSON.stringify({
      boardSize: 9,
      timeControl: "x".repeat(MAX_MATCHMAKING_MUTATION_BODY_BYTES),
    }),
    new Uint8Array([0xc3, 0x28]),
    JSON.stringify({ boardSize: 7, timeControl: "instant" }),
    JSON.stringify({ boardSize: "9", timeControl: "rapid" }),
    JSON.stringify({ boardSize: 9, timeControl: "instant" }),
  ]) {
    const { pool, statements } = authenticatedPool();
    const response = await withPool(pool, () => joinMatchmaking(request(body)));

    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await response.json()).code, "invalid_matchmaking_request");
    assert.equal(statements.filter(({ sql }) => sql.includes("auth_rate_limits")).length, 4);
    assert.equal(statements.length, 5);
    assert.equal(statements.some(({ sql }) => /matchmaking_queue|\bFROM games\b/.test(sql)), false);
  }
});

test("matchmaking join parser accepts the exact client payload with a JSON charset", async () => {
  const joinRequest = request(
    JSON.stringify({ timeControl: "rapid", boardSize: 9 }),
    true,
    "POST",
    { contentType: "application/json; charset=utf-8" },
  );
  assert.doesNotThrow(() => assertMatchmakingMutationMetadata(joinRequest, "json"));
  assert.deepEqual(await readMatchmakingJoinRequest(joinRequest), {
    timeControl: "rapid",
    boardSize: 9,
  });
});

test("current PlayWorkspace join payload reaches the matchmaking service boundary", async () => {
  const sentinel = new Error("matchmaking Pool.connect service-boundary sentinel");
  const { pool, statements } = authenticatedPool();
  let connectCalls = 0;
  Object.assign(pool, {
    async connect() {
      connectCalls += 1;
      throw sentinel;
    },
  });
  const consoleCalls: unknown[][] = [];
  const originalConsoleError = console.error;
  let response: Response;
  console.error = (...args: unknown[]) => {
    consoleCalls.push(args);
  };
  try {
    response = await withPool(pool, () => joinMatchmaking(request(
      JSON.stringify({ boardSize: 9, timeControl: "rapid" }),
    )));
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "The service is temporarily unavailable.",
    code: "internal_error",
  });
  assert.equal(connectCalls, 1);
  assert.equal(statements.filter(({ sql }) => sql.includes("FROM user_sessions s")).length, 1);
  assert.equal(statements.filter(({ sql }) => sql.includes("auth_rate_limits")).length, 4);
  assert.equal(statements.length, 5);
  assert.deepEqual(consoleCalls, [["API request failed:", sentinel]]);
});

test("matchmaking join preserves 401, 429, and 500 failure contracts", async () => {
  const noSession = await joinMatchmaking(request(
    JSON.stringify({ boardSize: 9, timeControl: "rapid" }),
    false,
  ));
  assert.equal(noSession.status, 401);
  assert.equal((await noSession.json()).code, "session_expired");

  const limited = authenticatedPool(() => ({
    rows: [{
      attempts: 2,
      window_started_at: new Date(),
      blocked_until: new Date(Date.now() + 11_000),
      retry_after_seconds: 11,
    }],
  }));
  const limitedResponse = await withPool(limited.pool, () => joinMatchmaking(request(
    JSON.stringify({ boardSize: 9, timeControl: "rapid" }),
  )));
  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedResponse.headers.get("Retry-After"), "11");
  assert.equal(limitedResponse.headers.get("set-cookie"), null);

  const failed = authenticatedPool(() => {
    throw new Error("database unavailable");
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const failedResponse = await withPool(failed.pool, () => joinMatchmaking(request(
      JSON.stringify({ boardSize: 9, timeControl: "rapid" }),
    )));
    assert.equal(failedResponse.status, 500);
    assert.equal(failedResponse.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.equal(failedResponse.headers.get("set-cookie"), null);
    assert.equal((await failedResponse.json()).code, "internal_error");
  } finally {
    console.error = originalConsoleError;
  }
});

test("cancellation returns the authoritative active match after locking", async () => {
  const matched = matchedCancellationPool();
  const response = await withPool(matched.pool, () => cancelMatchmaking(request(
    null,
    true,
    "DELETE",
  )));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), {
    ok: true,
    actor: "user:11111111-1111-4111-8111-111111111111",
    matchmaking: {
      status: "matched",
      gameId: matched.gameId,
      boardSize: 9,
      timeControl: "rapid",
    },
  });
  assert.equal(matched.getRateLimitWrites(), 2);
  const queueLock = matched.statements.findIndex(({ sql }) => sql.includes("FOR UPDATE OF q"));
  const gameRead = matched.statements.findIndex(({ sql }) => sql.includes("SELECT status FROM games"));
  assert.ok(queueLock >= 0 && gameRead > queueLock);
});

test("matchmaking mutations reject a stale displayed actor before rate or queue mutation", async () => {
  for (const mutation of [
    {
      handler: joinMatchmaking,
      request: request(JSON.stringify({ boardSize: 9, timeControl: "rapid" })),
    },
    { handler: cancelMatchmaking, request: request(null, true, "DELETE") },
  ]) {
    const { pool, statements } = authenticatedPool();
    mutation.request.headers.set(
      EXPECTED_PLAYER_HEADER,
      "user:22222222-2222-4222-8222-222222222222",
    );

    const response = await withPool(pool, () => mutation.handler(mutation.request));

    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "identity_changed");
    assert.equal(statements.filter(({ sql }) => sql.includes("auth_rate_limits")).length, 0);
    assert.equal(statements.filter(({ sql }) => sql.includes("matchmaking_queue")).length, 0);
  }
});
