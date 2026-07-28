import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool, PoolClient } from "pg";
import { POST as reportOpponent } from "@/app/api/games/[gameId]/report/route";
import { GUEST_SESSION_COOKIE } from "@/lib/auth/guestSession";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { SESSION_COOKIE } from "@/lib/auth/session";

const gameId = "33333333-3333-4333-8333-333333333333";
const accountPlayer = "user:11111111-1111-4111-8111-111111111111";
const guestPlayer = "guest:22222222-2222-4222-8222-222222222222";

class RoutePool {
  readonly reports = new Map<string, readonly unknown[]>();
  readonly statements: string[] = [];
  game: { black: string; white: string } | null = {
    black: accountPlayer,
    white: guestPlayer,
  };
  rateReservation = 0;
  readonly deniedRateReservations = new Map<number, number>();

  constructor(readonly identity: "account" | "guest" = "account") {}

  async connect() {
    return {
      query: this.transactionQuery.bind(this),
      release() {},
    } as unknown as PoolClient;
  }

  async query(sql: string, values: readonly unknown[] = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.statements.push(normalized);
    if (normalized.includes("FROM user_sessions s")) {
      return this.identity === "account" ? {
        rows: [{
          id: accountPlayer.slice("user:".length),
          username: "account_player",
          display_name: "Account Player",
          expires_at: new Date(Date.now() + 60_000),
        }],
        rowCount: 1,
      } : { rows: [], rowCount: 0 };
    }
    if (normalized.includes("FROM guest_sessions")) {
      return this.identity === "guest" ? {
        rows: [{ guest_id: guestPlayer.slice("guest:".length) }],
        rowCount: 1,
      } : { rows: [], rowCount: 0 };
    }
    if (normalized.includes("INSERT INTO auth_rate_limits")) {
      this.rateReservation += 1;
      const retryAfter = this.deniedRateReservations.get(this.rateReservation);
      return {
        rows: [{
          attempts: retryAfter === undefined ? 1 : 999,
          window_started_at: new Date(),
          blocked_until: retryAfter === undefined ? null : new Date(Date.now() + 60_000),
          retry_after_seconds: retryAfter ?? 60,
        }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected pool query: ${normalized} (${values.length})`);
  }

  async transactionQuery(sql: string, values: readonly unknown[] = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.statements.push(normalized);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized) || normalized.startsWith("SET LOCAL")) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.includes("FROM games") && normalized.includes("$2 IN")) {
      const actor = String(values[1]);
      const game = this.game;
      const visible = game
        && values[0] === gameId
        && (actor === game.black || actor === game.white);
      return {
        rows: visible ? [{
          black_player_key: game!.black,
          white_player_key: game!.white,
        }] : [],
        rowCount: visible ? 1 : 0,
      };
    }
    if (normalized.startsWith("INSERT INTO player_reports")) {
      const key = `${values[0]}\0${values[1]}`;
      const inserted = !this.reports.has(key);
      if (inserted) this.reports.set(key, [...values]);
      return { rows: [], rowCount: inserted ? 1 : 0 };
    }
    throw new Error(`Unexpected transaction query: ${normalized}`);
  }
}

async function withPool<T>(
  pool: RoutePool,
  action: () => Promise<T>,
  { reportingEnabled = true }: { reportingEnabled?: boolean } = {},
) {
  const previous = globalThis.goStonedDbPool;
  const previousGate = process.env.PLAYER_REPORTING_ENABLED;
  globalThis.goStonedDbPool = pool as unknown as Pool;
  globalThis.goStoneEphemeralRateLimits = new Map();
  if (reportingEnabled) process.env.PLAYER_REPORTING_ENABLED = "true";
  else delete process.env.PLAYER_REPORTING_ENABLED;
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previous;
    if (previousGate === undefined) delete process.env.PLAYER_REPORTING_ENABLED;
    else process.env.PLAYER_REPORTING_ENABLED = previousGate;
  }
}

function request(
  actor = accountPlayer,
  options: {
    body?: string;
    contentType?: string;
    cookie?: boolean;
    origin?: string;
    url?: string;
  } = {},
) {
  const identity = actor.startsWith("guest:") ? "guest" : "account";
  const body = options.body ?? JSON.stringify({ category: "abuse_or_hate" });
  return new NextRequest(
    options.url ?? `https://gostone.test/api/games/${gameId}/report`,
    {
      method: "POST",
      headers: {
        [EXPECTED_PLAYER_HEADER]: actor,
        "Content-Type": options.contentType ?? "application/json",
        "x-real-ip": "203.0.113.181",
        "sec-fetch-site": "same-origin",
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(options.cookie === false ? {} : {
          Cookie: identity === "guest"
            ? `${GUEST_SESSION_COOKIE}=${"g".repeat(43)}`
            : `${SESSION_COOKIE}=${"a".repeat(43)}`,
        }),
      },
      body,
    },
  );
}

const context = { params: Promise.resolve({ gameId }) };

test("report intake is indistinguishable and performs no work while the release gate is closed", async () => {
  const pool = new RoutePool();
  const response = await withPool(
    pool,
    () => reportOpponent(request(), context),
    { reportingEnabled: false },
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Game not found.",
    code: "game_not_found",
  });
  assert.equal(pool.statements.length, 0);
});

test("account and secure guest reports derive the opponent and disclose only a receipt", async (t) => {
  for (const identity of ["account", "guest"] as const) {
    await t.test(identity, async () => {
      const actor = identity === "account" ? accountPlayer : guestPlayer;
      const opponent = identity === "account" ? guestPlayer : accountPlayer;
      const pool = new RoutePool(identity);
      const response = await withPool(pool, () => reportOpponent(request(actor), context));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
      assert.deepEqual(await response.json(), { ok: true, actor, reported: true });
      assert.deepEqual(pool.reports.get(`${gameId}\0${actor}`), [
        gameId,
        actor,
        opponent,
        "abuse_or_hate",
      ]);
    });
  }
});

test("duplicate retries return the same opaque receipt and preserve the first category", async () => {
  const pool = new RoutePool();
  const first = await withPool(pool, () => reportOpponent(request(), context));
  const duplicate = await withPool(pool, () => reportOpponent(request(accountPlayer, {
    body: JSON.stringify({ category: "fair_play" }),
  }), context));
  assert.deepEqual(await first.json(), await duplicate.json());
  assert.equal(pool.reports.size, 1);
  assert.equal(pool.reports.get(`${gameId}\0${accountPlayer}`)?.[3], "abuse_or_hate");
});

test("cross-origin, wrong-content-type, query, and noncanonical requests fail before DB work", async () => {
  const cases: Array<{
    request: NextRequest;
    context?: { params: Promise<{ gameId: string }> };
  }> = [
    { request: request(accountPlayer, { origin: "https://attacker.test" }) },
    { request: request(accountPlayer, { contentType: "text/plain" }) },
    { request: request(accountPlayer, { url: `https://gostone.test/api/games/${gameId}/report?target=x` }) },
    {
      request: request(accountPlayer, { url: "https://gostone.test/api/games/NOT-A-UUID/report" }),
      context: { params: Promise.resolve({ gameId: "NOT-A-UUID" }) },
    },
  ];
  for (const entry of cases) {
    const pool = new RoutePool();
    const response = await withPool(pool, () => reportOpponent(
      entry.request,
      entry.context ?? context,
    ));
    assert.ok([400, 403, 404].includes(response.status));
    assert.equal(pool.statements.length, 0);
  }
});

test("forged fields, malformed JSON, unsupported categories, and oversized bodies never insert", async () => {
  const bodies = [
    JSON.stringify({ category: "fair_play", target: guestPlayer }),
    JSON.stringify({ category: "fair_play", status: "resolved" }),
    JSON.stringify({ reason: "fair_play" }),
    JSON.stringify({ category: "not_supported" }),
    JSON.stringify({ category: "fair_play\u0000" }),
    JSON.stringify(["fair_play"]),
    "not-json",
    JSON.stringify({ category: "x".repeat(300) }),
  ];
  for (const body of bodies) {
    const pool = new RoutePool();
    const response = await withPool(pool, () => reportOpponent(request(accountPlayer, { body }), context));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.equal(pool.reports.size, 0);
    assert.equal(pool.statements.some((sql) => sql.startsWith("INSERT INTO player_reports")), false);
  }
});

test("malformed bodies are metered before parsing but never reach the game", async () => {
  const pool = new RoutePool();
  const response = await withPool(pool, () => reportOpponent(request(accountPlayer, {
    body: "not-json",
  }), context));
  assert.equal(response.status, 400);
  assert.equal(pool.rateReservation, 4);
  assert.equal(pool.statements.some((sql) => sql.includes("FROM games")), false);
  assert.equal(pool.statements.some((sql) => sql.includes("player_reports")), false);
});

test("burst and hourly denials preserve Retry-After and stop before body or game access", async (t) => {
  for (const denial of [
    { name: "burst", reservations: [[1, 7], [2, 19]], total: 2, retryAfter: "19" },
    { name: "hourly", reservations: [[3, 11], [4, 23]], total: 4, retryAfter: "23" },
  ] as const) {
    await t.test(denial.name, async () => {
      const pool = new RoutePool();
      for (const [reservation, retryAfter] of denial.reservations) {
        pool.deniedRateReservations.set(reservation, retryAfter);
      }
      const response = await withPool(pool, () => reportOpponent(request(accountPlayer, {
        body: "not-json",
      }), context));
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("Retry-After"), denial.retryAfter);
      assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
      assert.equal((await response.json()).code, "rate_limited");
      assert.equal(pool.rateReservation, denial.total);
      assert.equal(pool.statements.some((sql) => sql.includes("FROM games")), false);
      assert.equal(pool.statements.some((sql) => sql.includes("player_reports")), false);
    });
  }
});

test("a stale expected-player binding fails before report rates or report access", async () => {
  const pool = new RoutePool();
  const stale = request(accountPlayer);
  stale.headers.set(EXPECTED_PLAYER_HEADER, guestPlayer);
  const response = await withPool(pool, () => reportOpponent(stale, context));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "identity_changed");
  assert.equal(pool.statements.some((sql) => sql.includes("auth_rate_limits")), false);
  assert.equal(pool.statements.some((sql) => sql.includes("player_reports")), false);
});

test("a forged player key without its secure cookie cannot report", async () => {
  const pool = new RoutePool();
  const response = await withPool(pool, () => reportOpponent(request(accountPlayer, {
    cookie: false,
  }), context));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "session_expired");
  assert.equal(pool.reports.size, 0);
});

test("missing games and outsiders have byte-equivalent private responses", async () => {
  const bodies: string[] = [];
  for (const setup of ["missing", "outsider"] as const) {
    const pool = new RoutePool();
    pool.game = setup === "missing"
      ? null
      : {
          black: "user:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          white: "guest:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        };
    const response = await withPool(pool, () => reportOpponent(request(), context));
    assert.equal(response.status, 404);
    bodies.push(await response.text());
    assert.equal(pool.reports.size, 0);
  }
  assert.equal(bodies[0], bodies[1]);
});

test("a corrupt same-player game fails without a report write", async () => {
  const pool = new RoutePool();
  pool.game = { black: accountPlayer, white: accountPlayer };
  const response = await withPool(pool, () => reportOpponent(request(), context));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "opponent_unavailable");
  assert.equal(pool.reports.size, 0);
});
