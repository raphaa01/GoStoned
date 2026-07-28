import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { GET as readGame } from "@/app/api/games/[gameId]/route";
import {
  createRateLimitKey,
  RATE_LIMIT_POLICIES,
} from "@/lib/auth/rateLimit";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { SESSION_COOKIE } from "@/lib/auth/session";

const gameId = "33333333-3333-4333-8333-333333333333";
const actor = "user:11111111-1111-4111-8111-111111111111";
const address = "203.0.113.191";

type Statement = { sql: string; values: readonly unknown[] };

function request(
  query = "",
  options: {
    authenticated?: boolean;
    expectedPlayer?: string | null;
  } = {},
) {
  const headers = new Headers({ "x-real-ip": address });
  if (options.authenticated !== false) {
    headers.set("Cookie", `${SESSION_COOKIE}=${"a".repeat(43)}`);
  }
  if (options.expectedPlayer !== null) {
    headers.set(EXPECTED_PLAYER_HEADER, options.expectedPlayer ?? actor);
  }
  return new NextRequest(`https://gostone.test/api/games/${gameId}${query}`, { headers });
}

function context(id = gameId) {
  return { params: Promise.resolve({ gameId: id }) };
}

async function withPool<T>(
  pool: Pool,
  action: () => Promise<T>,
  limits = new Map(),
): Promise<T> {
  const previousPool = globalThis.goStonedDbPool;
  const previousLimits = globalThis.goStoneEphemeralRateLimits;
  globalThis.goStonedDbPool = pool;
  globalThis.goStoneEphemeralRateLimits = limits;
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previousPool;
    globalThis.goStoneEphemeralRateLimits = previousLimits;
  }
}

function assertPrivateResponse(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(response.headers.get("set-cookie"), null);
}

function sessionRow() {
  return {
    id: actor.slice("user:".length),
    username: "route_player",
    display_name: "Route Player",
    expires_at: new Date(Date.now() + 60_000),
  };
}

function heartbeatRow() {
  return {
    id: gameId,
    black_player_key: actor,
    white_player_key: "user:22222222-2222-4222-8222-222222222222",
    winner_key: null,
    status: "active",
    phase: "play",
    to_move: "black",
    scoring_revision: 0,
    result: null,
    finish_reason: null,
    rules: "chinese",
    rules_profile: "chinese-2002-gostone-v1",
    scoring_method: "area",
    komi: "7.5",
    handicap: 0,
    main_time_seconds: 600,
    byo_yomi_periods: 5,
    byo_yomi_seconds: 30,
    black_time_remaining_ms: 600_000,
    white_time_remaining_ms: 600_000,
    black_periods_remaining: 5,
    white_periods_remaining: 5,
    turn_started_at: new Date(),
    version: 7,
    finished_at: null,
  };
}

function heartbeatPool() {
  const statements: Statement[] = [];
  const pool = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("FROM user_sessions s")) {
        return { rows: [sessionRow()], rowCount: 1 };
      }
      if (sql.includes("FROM games g")) {
        return { rows: [heartbeatRow()], rowCount: 1 };
      }
      throw new Error(`Unexpected game-read query: ${sql}`);
    },
  } as unknown as Pool;
  return { pool, statements };
}

test("game reads reject noncanonical query shapes before identity or database work", async () => {
  const invalidQueries = [
    "?knownVersion=",
    "?knownVersion=-1",
    "?knownVersion=+1",
    "?knownVersion=1.5",
    "?knownVersion=01",
    "?knownVersion=1&knownVersion=1",
    "?knownVersion=2147483648",
    "?knownVersion=9007199254740992",
    "?unknown=1",
    "?knownVersion=1&unknown=1",
    "?knownVersion=%31",
    "?known%56ersion=1",
    "?knownVersion=1&",
  ];

  for (const query of invalidQueries) {
    let databaseCalls = 0;
    const limits = new Map();
    const pool = {
      async query() {
        databaseCalls += 1;
        throw new Error("Invalid game reads must not query the database.");
      },
    } as unknown as Pool;
    const response = await withPool(
      pool,
      () => readGame(request(query), context()),
      limits,
    );

    assertPrivateResponse(response, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "The game read request is invalid.",
      code: "invalid_game_read_request",
    });
    assert.equal(databaseCalls, 0, query);
    assert.equal(limits.size, 0, query);
  }
});

test("noncanonical game identifiers return a private 404 before query parsing or identity", async () => {
  for (const [id, query] of [
    ["NOT-A-UUID", ""],
    ["33333333-3333-4333-8333-33333333333A", ""],
    [`${gameId}/extra`, "?knownVersion=1"],
    ["{33333333-3333-4333-8333-333333333333}", "?knownVersion=bogus"],
  ] as const) {
    let databaseCalls = 0;
    const limits = new Map();
    const pool = {
      async query() {
        databaseCalls += 1;
        throw new Error("Invalid game identifiers must not query the database.");
      },
    } as unknown as Pool;
    const response = await withPool(
      pool,
      () => readGame(request(query), context(id)),
      limits,
    );

    assertPrivateResponse(response, 404);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "Game not found.",
      code: "game_not_found",
    });
    assert.equal(databaseCalls, 0, id);
    assert.equal(limits.size, 0, id);
  }
});

test("no query and one canonical version reach their distinct service boundaries", async () => {
  for (const query of ["", "?knownVersion=7"] as const) {
    const sentinel = new Error(query === "" ? "full refresh sentinel" : "version poll sentinel");
    const statements: Statement[] = [];
    let connectCalls = 0;
    const pool = {
      async query(sql: string, values: readonly unknown[] = []) {
        statements.push({ sql, values });
        if (sql.includes("FROM user_sessions s")) {
          return { rows: [sessionRow()], rowCount: 1 };
        }
        if (sql.includes("FROM games g") && query !== "") throw sentinel;
        throw new Error(`Unexpected boundary query: ${sql}`);
      },
      async connect() {
        connectCalls += 1;
        if (query === "") throw sentinel;
        throw new Error("Version polling must not open a transaction before its header read.");
      },
    } as unknown as Pool;
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      const response = await withPool(pool, () => readGame(request(query), context()));
      assertPrivateResponse(response, 500);
      assert.equal((await response.json()).code, "internal_error");
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(
      statements.filter(({ sql }) => sql.includes("FROM user_sessions s")).length,
      1,
      query,
    );
    assert.equal(
      statements.filter(({ sql }) => sql.includes("FROM games g")).length,
      query === "" ? 0 : 1,
      query,
    );
    assert.equal(connectCalls, query === "" ? 1 : 0, query);
    assert.equal(statements.some(({ sql }) => sql.includes("auth_rate_limits")), false);
  }
});

test("a matching actor receives the current version heartbeat without persistent rate writes", async () => {
  const { pool, statements } = heartbeatPool();
  const response = await withPool(
    pool,
    () => readGame(request("?knownVersion=7"), context()),
  );

  assertPrivateResponse(response, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.unchanged, true);
  assert.equal(body.gameId, gameId);
  assert.equal(body.version, 7);
  assert.equal(body.clock.mainTimeSeconds, 600);
  assert.equal(statements.filter(({ sql }) => sql.includes("FROM user_sessions s")).length, 1);
  assert.equal(statements.filter(({ sql }) => sql.includes("FROM games g")).length, 1);
  assert.equal(statements.some(({ sql }) => sql.includes("auth_rate_limits")), false);
});

test("a missing or changed displayed actor stops before game rate limiting or access", async () => {
  for (const expectedPlayer of [
    null,
    "user:22222222-2222-4222-8222-222222222222",
  ]) {
    const statements: Statement[] = [];
    const limits = new Map();
    const pool = {
      async query(sql: string, values: readonly unknown[] = []) {
        statements.push({ sql, values });
        if (sql.includes("FROM user_sessions s")) {
          return { rows: [sessionRow()], rowCount: 1 };
        }
        throw new Error(`Unbound actors must not reach game data: ${sql}`);
      },
    } as unknown as Pool;
    const response = await withPool(
      pool,
      () => readGame(request("?knownVersion=7", { expectedPlayer }), context()),
      limits,
    );

    assertPrivateResponse(response, 409);
    assert.equal((await response.json()).code, "identity_changed");
    assert.equal(statements.length, 1, String(expectedPlayer));
    assert.match(statements[0].sql, /FROM user_sessions s/);
    assert.equal(statements.some(({ sql }) => /\bFROM games\b/.test(sql)), false);
    assert.equal(statements.some(({ sql }) => sql.includes("auth_rate_limits")), false);
    assert.equal(limits.size, 1);
  }
});

test("game-read rate denial is uncached and stops before game access", async () => {
  const statements: Statement[] = [];
  const pool = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("FROM user_sessions s")) {
        return { rows: [sessionRow()], rowCount: 1 };
      }
      throw new Error(`Rate-limited reads must not reach game data: ${sql}`);
    },
  } as unknown as Pool;
  const limits = new Map();
  limits.set(
    createRateLimitKey(RATE_LIMIT_POLICIES.gameRead.scope, "actor", actor),
    { attempts: RATE_LIMIT_POLICIES.gameRead.limit, windowStartedAt: Date.now(), blockedUntil: null },
  );

  const response = await withPool(
    pool,
    () => readGame(request("?knownVersion=7"), context()),
    limits,
  );

  assertPrivateResponse(response, 429);
  assert.equal((await response.json()).code, "rate_limited");
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
  assert.equal(statements.length, 1);
  assert.match(statements[0].sql, /FROM user_sessions s/);
});

test("an unauthenticated canonical read preserves the uncached session contract", async () => {
  let databaseCalls = 0;
  const pool = {
    async query() {
      databaseCalls += 1;
      throw new Error("A missing session must not query game data.");
    },
  } as unknown as Pool;
  const response = await withPool(
    pool,
    () => readGame(request("", { authenticated: false }), context()),
  );

  assertPrivateResponse(response, 401);
  assert.equal((await response.json()).code, "session_expired");
  assert.equal(databaseCalls, 0);
});
