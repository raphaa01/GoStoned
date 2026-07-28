import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool, PoolClient } from "pg";
import {
  DELETE as unblockOpponent,
  GET as readBlock,
  POST as blockOpponent,
} from "@/app/api/games/[gameId]/block/route";
import { GUEST_SESSION_COOKIE } from "@/lib/auth/guestSession";
import { EXPECTED_PLAYER_HEADER } from "@/lib/auth/playerBinding";
import { SESSION_COOKIE } from "@/lib/auth/session";

const gameId = "33333333-3333-4333-8333-333333333333";
const accountPlayer = "user:11111111-1111-4111-8111-111111111111";
const guestPlayer = "guest:22222222-2222-4222-8222-222222222222";

class RoutePool {
  readonly blocks = new Set<string>();
  readonly statements: string[] = [];
  game: { black: string; white: string } | null = {
    black: accountPlayer,
    white: guestPlayer,
  };

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
    if (normalized.includes("pg_advisory_xact_lock")) {
      return { rows: [{}], rowCount: 1 };
    }
    if (normalized.startsWith("SELECT EXISTS") && normalized.includes("FROM player_blocks")) {
      return {
        rows: [{ blocked: this.blocks.has(`${values[0]}\0${values[1]}`) }],
        rowCount: 1,
      };
    }
    if (normalized.startsWith("INSERT INTO player_blocks")) {
      this.blocks.add(`${values[0]}\0${values[1]}`);
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("DELETE FROM player_blocks")) {
      const deleted = this.blocks.delete(`${values[0]}\0${values[1]}`);
      return { rows: [], rowCount: deleted ? 1 : 0 };
    }
    throw new Error(`Unexpected transaction query: ${normalized}`);
  }
}

async function withPool<T>(pool: RoutePool, action: () => Promise<T>) {
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
  method: "GET" | "POST" | "DELETE",
  actor = accountPlayer,
  options: { url?: string; body?: string; origin?: string } = {},
) {
  const identity = actor.startsWith("guest:") ? "guest" : "account";
  return new NextRequest(
    options.url ?? `https://gostone.test/api/games/${gameId}/block`,
    {
      method,
      headers: {
        [EXPECTED_PLAYER_HEADER]: actor,
        "x-real-ip": "203.0.113.180",
        "sec-fetch-site": "same-origin",
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Cookie: identity === "guest"
          ? `${GUEST_SESSION_COOKIE}=${"g".repeat(43)}`
          : `${SESSION_COOKIE}=${"a".repeat(43)}`,
      },
      ...(options.body ? { body: options.body } : {}),
    },
  );
}

const context = { params: Promise.resolve({ gameId }) };

test("account and secure guest routes expose only the actor's idempotent state", async (t) => {
  for (const identity of ["account", "guest"] as const) {
    await t.test(identity, async () => {
      const actor = identity === "account" ? accountPlayer : guestPlayer;
      const opponent = identity === "account" ? guestPlayer : accountPlayer;
      const pool = new RoutePool(identity);
      const blocked = await withPool(pool, () => blockOpponent(request("POST", actor), context));
      assert.equal(blocked.status, 200);
      assert.equal(blocked.headers.get("Cache-Control"), "no-store, max-age=0");
      assert.deepEqual(await blocked.json(), { ok: true, actor, blocked: true });
      assert.deepEqual([...pool.blocks], [`${actor}\0${opponent}`]);

      const repeated = await withPool(pool, () => blockOpponent(request("POST", actor), context));
      assert.deepEqual(await repeated.json(), { ok: true, actor, blocked: true });
      assert.equal(pool.blocks.size, 1);

      const read = await withPool(pool, () => readBlock(request("GET", actor), context));
      assert.deepEqual(await read.json(), { ok: true, actor, blocked: true });

      const unblocked = await withPool(pool, () => unblockOpponent(
        request("DELETE", actor),
        context,
      ));
      assert.deepEqual(await unblocked.json(), { ok: true, actor, blocked: false });
      assert.equal(pool.blocks.size, 0);
    });
  }
});

test("arbitrary target bodies, query parameters, and cross-origin mutations are rejected pre-DB", async () => {
  const cases = [
    request("POST", accountPlayer, { body: JSON.stringify({ target: guestPlayer }) }),
    request("POST", accountPlayer, {
      url: `https://gostone.test/api/games/${gameId}/block?target=${guestPlayer}`,
    }),
    request("POST", accountPlayer, { origin: "https://attacker.test" }),
  ];
  for (const mutation of cases) {
    const pool = new RoutePool();
    const response = await withPool(pool, () => blockOpponent(mutation, context));
    assert.ok(response.status === 400 || response.status === 403);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.equal(pool.statements.length, 0);
  }
});

test("stale expected-player binding fails before rates or block access", async () => {
  const pool = new RoutePool();
  const stale = request("POST", accountPlayer);
  stale.headers.set(EXPECTED_PLAYER_HEADER, guestPlayer);
  const response = await withPool(pool, () => blockOpponent(stale, context));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "identity_changed");
  assert.equal(pool.statements.filter((sql) => sql.includes("auth_rate_limits")).length, 0);
  assert.equal(pool.statements.filter((sql) => sql.includes("player_blocks")).length, 0);
});

test("outsiders and absent games have the same private route response", async () => {
  const bodies: unknown[] = [];
  for (const setup of ["missing", "outsider"] as const) {
    const pool = new RoutePool();
    pool.game = setup === "missing"
      ? null
      : {
          black: "user:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          white: "guest:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        };
    const response = await withPool(pool, () => readBlock(request("GET"), context));
    assert.equal(response.status, 404);
    bodies.push(await response.json());
  }
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(bodies[0], {
    ok: false,
    error: "Game not found.",
    code: "game_not_found",
  });
});

test("a corrupt same-player game returns a stable conflict without a block write", async () => {
  const pool = new RoutePool();
  pool.game = { black: accountPlayer, white: accountPlayer };

  const response = await withPool(pool, () => blockOpponent(request("POST"), context));

  assert.equal(response.status, 409);
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "The opponent is unavailable for this action.",
    code: "opponent_unavailable",
  });
  assert.equal(pool.blocks.size, 0);
});

test("non-canonical game identifiers are rejected before identity lookup", async () => {
  const pool = new RoutePool();
  const response = await withPool(pool, () => readBlock(
    request("GET", accountPlayer, {
      url: "https://gostone.test/api/games/NOT-A-UUID/block",
    }),
    { params: Promise.resolve({ gameId: "NOT-A-UUID" }) },
  ));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "game_not_found");
  assert.equal(pool.statements.length, 0);
});
