import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { GET } from "@/app/api/stats/route";

const observedAt = new Date("2026-07-28T20:15:00.000Z");

function request(address: string, query: string) {
  return new NextRequest(`https://gostone.test/api/stats${query}`, {
    headers: { "x-real-ip": address },
  });
}

async function withPool<T>(pool: Pool, action: () => Promise<T>): Promise<T> {
  const previousPool = globalThis.goStonedDbPool;
  const previousLimits = globalThis.goStoneEphemeralRateLimits;
  globalThis.goStonedDbPool = pool;
  globalThis.goStoneEphemeralRateLimits = new Map();
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previousPool;
    globalThis.goStoneEphemeralRateLimits = previousLimits;
  }
}

function snapshotPool(onQuery?: (sql: string, values: readonly unknown[]) => void) {
  return {
    async query(sql: string, values: readonly unknown[]) {
      onQuery?.(sql.replace(/\s+/g, " ").trim(), values);
      return {
        rows: [{
          observed_at: observedAt,
          entries: [{
            position: 1,
            playerName: "Visible Player",
            games: 3,
            wins: 2,
            rating: 1_216,
            ratingDeviation: 72,
          }],
        }],
        rowCount: 1,
      };
    },
  } as unknown as Pool;
}

test("leaderboard returns one narrow global public snapshot with shared caching", async () => {
    let values: readonly unknown[] = [];
    const response = await withPool(
      snapshotPool((_sql, parameters) => {
        values = parameters;
      }),
      () => GET(request("203.0.113.19", "")),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cache-control"),
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    );
    assert.deepEqual(values, [50, "all-rated"]);
    assert.deepEqual(body, {
      ok: true,
      leaderboard: [{
        position: 1,
        playerName: "Visible Player",
        games: 3,
        wins: 2,
        rating: 1_216,
        ratingDeviation: 72,
      }],
      observedAt: observedAt.toISOString(),
      opponentScope: "all-rated",
    });
    assert.deepEqual(Object.keys(body.leaderboard[0]), [
      "position",
      "playerName",
      "games",
      "wins",
      "rating",
      "ratingDeviation",
    ]);
});

test("leaderboard rejects noncanonical query shapes before rate limiting or database work", async () => {
  const invalidQueries = [
    "?boardSize=",
    "?boardSize=bogus",
    "?boardSize=09",
    "?boardSize=9.0",
    "?boardSize=9&boardSize=13",
    "?boardSize=9&cacheBust=1",
    "?boardSize=%39",
    "?board%53ize=9",
    "?boardSize=9&",
    "?boardsize=9",
  ];

  for (const [index, query] of invalidQueries.entries()) {
    let databaseCalls = 0;
    const pool = {
      async query() {
        databaseCalls += 1;
        throw new Error("Invalid stats requests must not query the database.");
      },
    } as unknown as Pool;
    const response = await withPool(pool, async () => {
      const result = await GET(request(`203.0.114.${index + 1}`, query));
      assert.equal(globalThis.goStoneEphemeralRateLimits?.size ?? 0, 0);
      return result;
    });

    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "Use either the global leaderboard or the exact human-only opponent filter.",
      code: "invalid_stats_request",
    });
    assert.equal(databaseCalls, 0);
  }
});

test("leaderboard exposes one canonical human-only opponent filter", async () => {
  let values: readonly unknown[] = [];
  const response = await withPool(
    snapshotPool((_sql, parameters) => { values = parameters; }),
    () => GET(request("203.0.113.77", "?opponents=human-only")),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(values, [50, "human-only"]);
  assert.equal((await response.json()).opponentScope, "human-only");
});

test("leaderboard rate limiting keeps denials uncached and stops database amplification", async () => {
  let queries = 0;
  const pool = snapshotPool(() => {
    queries += 1;
  });

  await withPool(pool, async () => {
    let response: Response | null = null;
    for (let attempt = 0; attempt <= 60; attempt += 1) {
      response = await GET(request("203.0.113.201", ""));
    }
    assert.equal(response?.status, 429);
    assert.equal(response?.headers.get("cache-control"), "no-store, max-age=0");
    assert.ok(Number(response?.headers.get("retry-after")) > 0);
    assert.equal((await response?.json()).code, "rate_limited");
  });
  assert.equal(queries, 60);
});

test("leaderboard database failures return a stable uncached localized error code", async () => {
  const pool = {
    async query() {
      throw new Error("database unavailable");
    },
  } as unknown as Pool;
  const previousError = console.error;
  console.error = () => undefined;
  try {
    const response = await withPool(
      pool,
      () => GET(request("203.0.113.202", "")),
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "Stats are temporarily unavailable.",
      code: "internal_error",
    });
  } finally {
    console.error = previousError;
  }
});
