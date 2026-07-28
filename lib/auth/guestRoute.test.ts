import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool, PoolClient } from "pg";
import { POST as createOrReadGuest } from "@/app/api/auth/guest/route";
import {
  GUEST_SESSION_COOKIE,
  hashGuestSessionToken,
} from "./guestSession";

type Statement = { sql: string; values: readonly unknown[] };

async function withPool<T>(pool: Pool, action: () => Promise<T>): Promise<T> {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = pool;
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previous;
  }
}

function guestRequest(headers: Record<string, string> = {}) {
  return new NextRequest("https://gostone.test/api/auth/guest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-real-ip": "203.0.113.40",
      ...headers,
    },
    body: "{}",
  });
}

function allowedRateLimitRow() {
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

test("guest issuance rejects cross-site and form requests before database work", async () => {
  const validToken = "valid-current-guest-token";
  const variants: Array<Record<string, string>> = [
    { Origin: "https://attacker.example" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Content-Type": "application/x-www-form-urlencoded" },
    {
      Cookie: `${GUEST_SESSION_COOKIE}=${validToken}`,
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    },
  ];

  for (const headers of variants) {
    let databaseCalls = 0;
    const pool = {
      async query() {
        databaseCalls += 1;
        throw new Error("Rejected guest requests must not query the database.");
      },
      async connect() {
        databaseCalls += 1;
        throw new Error("Rejected guest requests must not open a transaction.");
      },
    } as unknown as Pool;

    const response = await withPool(pool, () => createOrReadGuest(guestRequest(headers)));

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "The authentication request is not allowed.",
      code: "request_rejected",
    });
    assert.equal(databaseCalls, 0);
  }
});

test("same-origin JSON creates a guest session with a hardened cookie", async () => {
  const guestId = "11111111-1111-4111-8111-111111111111";
  const statements: Statement[] = [];
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("INSERT INTO guest_sessions")) {
        return { rows: [{ guest_id: guestId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  } as unknown as PoolClient;
  const pool = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("INSERT INTO auth_rate_limits")) return allowedRateLimitRow();
      if (sql.includes("FROM guest_sessions")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected pool statement: ${sql}`);
    },
    async connect() {
      return client;
    },
  } as unknown as Pool;

  const response = await withPool(pool, () => createOrReadGuest(guestRequest({
    Origin: "https://gostone.test",
    "Sec-Fetch-Site": "same-origin",
  })));

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    ok: true,
    identity: {
      playerKey: `guest:${guestId}`,
      displayName: "Guest 111111",
    },
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`^${GUEST_SESSION_COOKIE}=`));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.match(cookie, /Path=\//i);
  assert.equal(
    statements.filter(({ sql }) => sql.includes("INSERT INTO guest_sessions")).length,
    1,
  );
});

test("same-origin JSON reuses a valid guest session without issuing another cookie", async () => {
  const token = "valid-current-guest-token";
  const guestId = "22222222-2222-4222-8222-222222222222";
  const statements: Statement[] = [];
  let transactionStarts = 0;
  const pool = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("INSERT INTO auth_rate_limits")) return allowedRateLimitRow();
      if (sql.includes("FROM guest_sessions")) {
        assert.deepEqual(values, [hashGuestSessionToken(token)]);
        return { rows: [{ guest_id: guestId }], rowCount: 1 };
      }
      throw new Error(`Unexpected pool statement: ${sql}`);
    },
    async connect() {
      transactionStarts += 1;
      throw new Error("A reused guest session must not open a transaction.");
    },
  } as unknown as Pool;

  const response = await withPool(pool, () => createOrReadGuest(guestRequest({
    Cookie: `${GUEST_SESSION_COOKIE}=${token}`,
    Origin: "https://gostone.test",
    "Sec-Fetch-Site": "same-origin",
  })));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), {
    ok: true,
    identity: {
      playerKey: `guest:${guestId}`,
      displayName: "Guest 222222",
    },
  });
  assert.equal(transactionStarts, 0);
  assert.equal(
    statements.some(({ sql }) => sql.includes("INSERT INTO guest_sessions")),
    false,
  );
});
