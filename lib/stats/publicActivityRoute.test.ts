import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { GET } from "@/app/api/games/route";

const observedAt = new Date("2026-07-28T20:15:00.000Z");

function request(address: string, query = "") {
  return new NextRequest(`https://gostone.test/api/games${query}`, {
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

test("public activity reports stored facts without inventing online presence", async () => {
  let statement = "";
  const pool = {
    async query(sql: string) {
      statement = sql.replace(/\s+/g, " ").trim();
      return {
        rows: [{
          unfinished_games: "10",
          games_started_last_24_hours: "7",
          recently_waiting_players: "4",
          observed_at: observedAt,
        }],
        rowCount: 1,
      };
    },
  } as unknown as Pool;

  const response = await withPool(pool, () => GET(request("203.0.113.151")));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  );
  assert.deepEqual(body.summary, {
    unfinishedGames: 10,
    gamesStartedLast24Hours: 7,
    recentlyWaitingPlayers: "under_5",
    observedAt: observedAt.toISOString(),
  });
  assert.equal("playersOnline" in body.summary, false);
  assert.equal("liveGames" in body.summary, false);
  assert.equal("unfinishedByBoard" in body.summary, false);
  assert.match(statement, /status = 'active'/);
  assert.doesNotMatch(statement, /board_size/);
  assert.match(statement, /started_at >= NOW\(\) - INTERVAL '24 hours'/);
  assert.match(statement, /status = 'waiting' AND updated_at >= NOW\(\) - INTERVAL '5 minutes'/);
  assert.match(statement, /statement_timestamp\(\) AS observed_at/);
});

test("public activity rate limiting stops database amplification", async () => {
  let queries = 0;
  const pool = {
    async query() {
      queries += 1;
      return {
        rows: [{
          unfinished_games: "0",
          games_started_last_24_hours: "0",
          recently_waiting_players: "0",
          observed_at: observedAt,
        }],
        rowCount: 1,
      };
    },
  } as unknown as Pool;

  await withPool(pool, async () => {
    let response: Response | null = null;
    for (let attempt = 0; attempt <= 20; attempt += 1) {
      response = await GET(request("203.0.113.152"));
      if (attempt === 0) {
        assert.deepEqual((await response.json()).summary, {
          unfinishedGames: 0,
          gamesStartedLast24Hours: 0,
          recentlyWaitingPlayers: 0,
          observedAt: observedAt.toISOString(),
        });
      }
    }
    assert.equal(response?.status, 429);
    assert.equal(response?.headers.get("cache-control"), "no-store, max-age=0");
    assert.ok(Number(response?.headers.get("retry-after")) > 0);
  });
  assert.equal(queries, 20);
});

test("public activity fails closed when aggregate evidence is malformed", async () => {
  let invalidValue = "";
  const pool = {
    async query() {
      return {
        rows: [{
          unfinished_games: invalidValue,
          games_started_last_24_hours: "0",
          recently_waiting_players: "0",
          observed_at: observedAt,
        }],
        rowCount: 1,
      };
    },
  } as unknown as Pool;

  const previousError = console.error;
  console.error = () => undefined;
  try {
    await withPool(pool, async () => {
      for (const value of ["", " ", "0x10", "1e3", "01", "not-a-count"]) {
        invalidValue = value;
        const response = await GET(request("203.0.113.153"));
        assert.equal(response.status, 500, JSON.stringify(value));
        assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
        assert.equal((await response.json()).code, "internal_error");
      }
    });
  } finally {
    console.error = previousError;
  }
});

test("public activity rejects cache-busting query parameters before database work", async () => {
  let queries = 0;
  const pool = {
    async query() {
      queries += 1;
      throw new Error("The query must not run.");
    },
  } as unknown as Pool;

  const response = await withPool(
    pool,
    () => GET(request("203.0.113.154", "?cache-bust=1")),
  );
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal((await response.json()).code, "invalid_activity_request");
  assert.equal(queries, 0);
});

test("the landing activity view discloses freshness, loading, and failure semantics", () => {
  const component = readFileSync(
    new URL("../../components/home/Hero.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    component,
    /playersOnline|liveGames|gamesToday|activeByBoard|unfinishedByBoard/,
  );
  assert.match(component, /activityDefinition/);
  assert.match(component, /activityLoading/);
  assert.match(component, /activityUnavailable/);
  assert.match(component, /retryActivity/);
  assert.match(component, /retryingActivity/);
  assert.match(component, /fewerThanFive/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /disabled=\{retrying\}/);
  assert.match(component, /ref=\{statusRef\}/);
  assert.match(component, /statusRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(component, /api\/health|api\/db-health|service-status/);
});
