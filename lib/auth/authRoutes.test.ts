import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as register } from "@/app/api/auth/register/route";
import { GET as readSession } from "@/app/api/auth/session/route";
import { SESSION_COOKIE } from "./session";
import { hashPassword } from "./password";
import { createRateLimitKey, RATE_LIMIT_POLICIES } from "./rateLimit";
import { MAX_CREDENTIAL_REQUEST_BODY_BYTES } from "./credentialRequest";

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

function malformedRequest(path: string, address: string) {
  return new NextRequest(`https://gostone.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-real-ip": address,
    },
    body: "{",
  });
}

function credentialRequest(
  path: string,
  address: string,
  headers: Record<string, string> = {},
  body = JSON.stringify(path.endsWith("/register")
    ? {
        username: "named_player",
        password: "password123",
        startingStrength: "unspecified",
        knownRank: null,
      }
    : { username: "named_player", password: "password123" }),
) {
  return new NextRequest(`https://gostone.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-real-ip": address,
      ...headers,
    },
    body,
  });
}

function allowedRateLimitRow() {
  return {
    rows: [{
      attempts: 1,
      window_started_at: new Date(),
      blocked_until: null,
      retry_after_seconds: 1,
    }],
  };
}

test("session lookup clears a presented invalid account cookie", async () => {
  const pool = {
    async query(sql: string) {
      if (sql.includes("INSERT INTO auth_rate_limits")) return allowedRateLimitRow();
      if (sql.includes("FROM user_sessions s")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected statement: ${sql}`);
    },
  } as unknown as Pool;
  const response = await withPool(pool, () => readSession(new NextRequest(
    "https://gostone.test/api/auth/session",
    {
      headers: {
        Cookie: `${SESSION_COOKIE}=${"a".repeat(43)}`,
        "x-real-ip": "203.0.113.60",
      },
    },
  )));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, user: null });
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/i);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
});

test("login and registration rate-limit the address before parsing malformed JSON", async () => {
  for (const [path, handler] of [
    ["/api/auth/login", login],
    ["/api/auth/register", register],
  ] as const) {
    const statements: Statement[] = [];
    const pool = {
      async query(sql: string, values: readonly unknown[]) {
        statements.push({ sql, values });
        assert.match(sql, /INSERT INTO auth_rate_limits/);
        return {
          rows: [{
            attempts: 1,
            window_started_at: new Date(),
            blocked_until: null,
            retry_after_seconds: 900,
          }],
        };
      },
    } as unknown as Pool;

    const response = await withPool(
      pool,
      () => handler(malformedRequest(path, path.endsWith("login") ? "203.0.113.61" : "203.0.113.62")),
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "The request body must be valid JSON.",
      code: "invalid_request",
    });
    assert.equal(statements.length, 1);
  }
});

test("login and registration reject extra or oversized fields before account service work", async () => {
  for (const [path, handler] of [
    ["/api/auth/login", login],
    ["/api/auth/register", register],
  ] as const) {
    for (const body of [
      JSON.stringify({ username: "named_player", password: "password123", padding: "" }),
      JSON.stringify({
        username: "named_player",
        password: "password123",
        padding: "x".repeat(MAX_CREDENTIAL_REQUEST_BODY_BYTES),
      }),
    ]) {
      const statements: Statement[] = [];
      const pool = {
        async query(sql: string, values: readonly unknown[]) {
          statements.push({ sql, values });
          assert.match(sql, /INSERT INTO auth_rate_limits/);
          return allowedRateLimitRow();
        },
      } as unknown as Pool;

      const response = await withPool(pool, () => handler(credentialRequest(
        path,
        path.endsWith("login") ? "203.0.113.63" : "203.0.113.64",
        {},
        body,
      )));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "invalid_request");
      assert.equal(statements.length, 1);
      assert.equal(statements.some(({ sql }) => sql.includes("FROM users")), false);
      assert.equal(statements.some(({ sql }) => sql === "BEGIN"), false);
    }
  }
});

test("login and registration reject cross-site credential mutations before address accounting", async () => {
  const variants: Array<Record<string, string>> = [
    { "Content-Type": "text/plain" },
    { "Sec-Fetch-Site": "cross-site" },
    { Origin: "https://attacker.example" },
  ];

  for (const [path, handler] of [
    ["/api/auth/login", login],
    ["/api/auth/register", register],
  ] as const) {
    for (const [index, headers] of variants.entries()) {
      const statements: Statement[] = [];
      const pool = {
        async query(sql: string, values: readonly unknown[]) {
          statements.push({ sql, values });
          assert.match(sql, /INSERT INTO auth_rate_limits/);
          return allowedRateLimitRow();
        },
      } as unknown as Pool;

      const response = await withPool(pool, () => handler(credentialRequest(
        path,
        `203.0.113.${80 + index}`,
        headers,
      )));

      assert.equal(response.status, 403);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.deepEqual(await response.json(), {
        ok: false,
        error: "The authentication request is not allowed.",
        code: "request_rejected",
      });
      assert.equal(statements.length, 0);
    }
  }
});

test("logout rejects cross-origin requests without clearing the cookie or session", async () => {
  const statements: Statement[] = [];
  const pool = {
    async query(sql: string, values: readonly unknown[]) {
      statements.push({ sql, values });
      throw new Error("Cross-origin logout must not reach the database.");
    },
  } as unknown as Pool;
  const request = new NextRequest("https://gostone.test/api/auth/logout", {
    method: "POST",
    headers: {
      Cookie: `gostoned_session=${"a".repeat(43)}`,
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    },
  });

  const response = await withPool(pool, () => logout(request));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(statements.length, 0);
});

test("invalid credentials return 401 after reserving the shared account slot", async () => {
  const passwordHash = await hashPassword("different-password");
  const statements: Statement[] = [];
  const pool = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("INSERT INTO auth_rate_limits")) return allowedRateLimitRow();
      if (sql.includes("FROM users")) {
        return {
          rows: [{
            id: "44444444-4444-4444-8444-444444444444",
            username: "named_player",
            display_name: "Named Player",
            password_hash: passwordHash,
          }],
        };
      }
      throw new Error(`Unexpected statement: ${sql}`);
    },
  } as unknown as Pool;

  const response = await withPool(pool, () => login(credentialRequest(
    "/api/auth/login",
    "203.0.113.90",
  )));

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await response.json()).code, "invalid_credentials");
  const accountKey = createRateLimitKey(
    RATE_LIMIT_POLICIES.loginAccountBurst.scope,
    "subject",
    "named_player",
  );
  const accountReservation = statements.find(
    ({ sql, values }) => sql.includes("INSERT INTO auth_rate_limits") && values[0] === accountKey,
  );
  const userLookupIndex = statements.findIndex(({ sql }) => sql.includes("FROM users"));
  assert.ok(accountReservation);
  assert.ok(statements.indexOf(accountReservation) < userLookupIndex);
});

test("account and address denials return 429 without authenticating", async () => {
  for (const deniedBucket of ["address", "account"] as const) {
    const statements: Statement[] = [];
    let rateLimitWrites = 0;
    const pool = {
      async query(sql: string, values: readonly unknown[]) {
        statements.push({ sql, values });
        assert.match(sql, /INSERT INTO auth_rate_limits/);
        rateLimitWrites += 1;
        const denied = deniedBucket === "address" ? rateLimitWrites === 1 : rateLimitWrites === 3;
        return denied
          ? {
              rows: [{
                attempts: 2,
                window_started_at: new Date(),
                blocked_until: new Date(Date.now() + 17_000),
                retry_after_seconds: 17,
              }],
            }
          : allowedRateLimitRow();
      },
    } as unknown as Pool;

    const response = await withPool(pool, () => login(
      deniedBucket === "address"
        ? malformedRequest("/api/auth/login", "203.0.113.91")
        : credentialRequest("/api/auth/login", "203.0.113.92"),
    ));

    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "17");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await response.json()).code, "rate_limited");
    assert.equal(statements.some(({ sql }) => sql.includes("FROM users")), false);
    assert.equal(statements.length, deniedBucket === "address" ? 1 : 3);
  }
});

test("parallel cross-address guesses admit only one password verification", async () => {
  const username = "parallel_player";
  const passwordHash = await hashPassword("different-password");
  const accountKey = createRateLimitKey(
    RATE_LIMIT_POLICIES.loginAccountBurst.scope,
    "subject",
    username,
  );
  let accountReservations = 0;
  let passwordLookups = 0;
  const pool = {
    async query(sql: string, values: readonly unknown[]) {
      if (sql.includes("INSERT INTO auth_rate_limits")) {
        if (values[0] !== accountKey) return allowedRateLimitRow();
        const reservation = ++accountReservations;
        await Promise.resolve();
        const denied = reservation > RATE_LIMIT_POLICIES.loginAccountBurst.limit;
        return {
          rows: [{
            attempts: reservation,
            window_started_at: new Date(),
            blocked_until: denied ? new Date(Date.now() + 1_000) : null,
            retry_after_seconds: 1,
          }],
        };
      }
      if (sql.includes("FROM users")) {
        passwordLookups += 1;
        return {
          rows: [{
            id: "55555555-5555-4555-8555-555555555555",
            username,
            display_name: "Parallel Player",
            password_hash: passwordHash,
          }],
        };
      }
      throw new Error(`Unexpected statement: ${sql}`);
    },
  } as unknown as Pool;

  const responses = await withPool(pool, () => Promise.all(
    Array.from({ length: 20 }, (_value, index) => login(credentialRequest(
      "/api/auth/login",
      `198.51.100.${index + 1}`,
      {},
      JSON.stringify({ username, password: "password123" }),
    ))),
  ));

  assert.equal(responses.filter(({ status }) => status === 401).length, 1);
  assert.equal(responses.filter(({ status }) => status === 429).length, 19);
  assert.equal(passwordLookups, 1);
  assert.equal(responses.some((response) => response.headers.has("set-cookie")), false);
});

test("login infrastructure failures return a no-store 500 without a session cookie", async () => {
  const pool = {
    async query() {
      throw new Error("database unavailable");
    },
  } as unknown as Pool;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await withPool(pool, () => login(credentialRequest(
      "/api/auth/login",
      "203.0.113.93",
    )));
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await response.json()).code, "login_failed");
  } finally {
    console.error = originalConsoleError;
  }
});

test("session issuance failure after authentication rolls back and sets no login cookie", async () => {
  const passwordHash = await hashPassword("password123");
  const transactionStatements: string[] = [];
  let released = false;
  const client = {
    async query(sql: string) {
      transactionStatements.push(sql);
      if (sql.includes("WITH expired_sessions AS MATERIALIZED")) {
        throw new Error("cleanup unavailable");
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    },
  };
  const pool = {
    async query(sql: string) {
      if (sql.includes("INSERT INTO auth_rate_limits")) return allowedRateLimitRow();
      if (sql.includes("FROM users")) {
        return {
          rows: [{
            id: "66666666-6666-4666-8666-666666666666",
            username: "named_player",
            display_name: "Named Player",
            password_hash: passwordHash,
          }],
        };
      }
      if (sql.startsWith("DELETE FROM auth_rate_limits")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected pool statement: ${sql}`);
    },
    async connect() {
      return client;
    },
  } as unknown as Pool;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await withPool(pool, () => login(credentialRequest(
      "/api/auth/login",
      "203.0.113.94",
    )));

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await response.json()).code, "login_failed");
    assert.equal(released, true);
    assert.equal(
      transactionStatements.some((sql) => sql.includes("INSERT INTO user_sessions")),
      true,
    );
    assert.equal(transactionStatements.at(-1), "ROLLBACK");
    assert.equal(transactionStatements.includes("COMMIT"), false);
  } finally {
    console.error = originalConsoleError;
  }
});

test("successful registration exposes only the committed user and hardened session cookie", async () => {
  const transactionStatements: string[] = [];
  let storedTokenHash: string | null = null;
  let committed = false;
  const userId = "88888888-8888-4888-8888-888888888888";
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      transactionStatements.push(sql.replace(/\s+/g, " ").trim());
      if (sql === "BEGIN" || sql.startsWith("SET LOCAL")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO users")) {
        return {
          rows: [{ id: userId, username: values[0], display_name: values[0] }],
          rowCount: 1,
        };
      }
      if (sql.includes("INSERT INTO user_sessions")) {
        storedTokenHash = String(values[1]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("WITH expired_sessions AS MATERIALIZED")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql === "COMMIT") {
        committed = true;
        return { rows: [], rowCount: 0 };
      }
      if (sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected transaction statement: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async query(sql: string) {
      if (sql.includes("INSERT INTO auth_rate_limits")) return allowedRateLimitRow();
      throw new Error(`Unexpected pool statement: ${sql}`);
    },
    connect: async () => client,
  } as unknown as Pool;

  const response = await withPool(pool, () => register(credentialRequest(
    "/api/auth/register",
    "203.0.113.99",
    {},
    JSON.stringify({
      username: "atomic_player",
      password: "password123",
      startingStrength: "known",
      knownRank: "12k",
    }),
  )));

  assert.equal(committed, true);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.deepEqual(await response.clone().json(), {
    ok: true,
    user: {
      id: userId,
      username: "atomic_player",
      displayName: "atomic_player",
      playerKey: `user:${userId}`,
      avatarStyle: "kifu-classic",
    },
  });
  const accountStatement = transactionStatements[2];
  assert.match(accountStatement, /^WITH account AS/);
  assert.match(accountStatement, /INSERT INTO player_rating_preferences/);
  assert.match(accountStatement, /INSERT INTO player_glicko2_ratings/);
  assert.deepEqual(transactionStatements.slice(3), [
    "INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')",
    "WITH expired_sessions AS MATERIALIZED ( SELECT user_session.id FROM user_sessions AS user_session WHERE user_session.expires_at <= NOW() ORDER BY user_session.expires_at, user_session.id LIMIT 200 FOR UPDATE OF user_session SKIP LOCKED ) DELETE FROM user_sessions AS user_session USING expired_sessions AS expired WHERE user_session.id = expired.id",
    "COMMIT",
  ]);

  const cookie = response.headers.get("set-cookie") ?? "";
  const token = cookie.match(/^gostoned_session=([^;]+)/)?.[1];
  assert.ok(token);
  assert.equal(createHash("sha256").update(token).digest("hex"), storedTokenHash);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.match(cookie, /Path=\//i);
  assert.match(cookie, /Max-Age=2592000/i);
  assert.match(cookie, /Priority=high/i);
});

test("registration failures roll back the account and never set a session cookie", async (t) => {
  const cases = [
    { stage: "username", status: 409, code: "username_taken" },
    { stage: "user-primary", status: 500, code: "register_failed" },
    { stage: "session", status: 500, code: "register_failed" },
    { stage: "cleanup", status: 500, code: "register_failed" },
    { stage: "commit-rejected", status: 500, code: "register_failed" },
  ] as const;

  for (const [index, failure] of cases.entries()) {
    await t.test(failure.stage, async () => {
      const transactionStatements: string[] = [];
      let stagedUser = false;
      let committedUser = false;
      let released = false;
      const client = {
        async query(sql: string, values: readonly unknown[] = []) {
          transactionStatements.push(sql.replace(/\s+/g, " ").trim());
          if (sql === "BEGIN" || sql.startsWith("SET LOCAL")) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("INSERT INTO users")) {
            if (failure.stage === "username" || failure.stage === "user-primary") {
              throw Object.assign(new Error("unique user conflict"), {
                code: "23505",
                constraint: failure.stage === "username" ? "users_username_key" : "users_pkey",
              });
            }
            stagedUser = true;
            return {
              rows: [{
                id: "88888888-8888-4888-8888-888888888888",
                username: values[0],
                display_name: values[0],
              }],
              rowCount: 1,
            };
          }
          if (sql.includes("INSERT INTO user_sessions")) {
            if (failure.stage === "session") {
              throw Object.assign(new Error("duplicate session token"), {
                code: "23505",
                constraint: "user_sessions_token_hash_key",
              });
            }
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes("WITH expired_sessions AS MATERIALIZED")) {
            if (failure.stage === "cleanup") throw new Error("cleanup unavailable");
            return { rows: [], rowCount: 0 };
          }
          if (sql === "COMMIT") {
            // This is a deterministic database rejection, not an ambiguous
            // connection loss after the server may already have committed.
            if (failure.stage === "commit-rejected") throw new Error("commit rejected");
            committedUser = stagedUser;
            return { rows: [], rowCount: 0 };
          }
          if (sql === "ROLLBACK") {
            stagedUser = false;
            return { rows: [], rowCount: 0 };
          }
          throw new Error(`Unexpected transaction statement: ${sql}`);
        },
        release() {
          released = true;
        },
      };
      const pool = {
        async query(sql: string) {
          if (sql.includes("INSERT INTO auth_rate_limits")) return allowedRateLimitRow();
          throw new Error(`Unexpected pool statement: ${sql}`);
        },
        connect: async () => client,
      } as unknown as Pool;
      const originalConsoleError = console.error;
      console.error = () => {};
      try {
        const response = await withPool(pool, () => register(credentialRequest(
          "/api/auth/register",
          `203.0.113.${100 + index}`,
          {},
          JSON.stringify({
            username: `atomic_${index}`,
            password: "password123",
            startingStrength: "unspecified",
            knownRank: null,
          }),
        )));

        assert.equal(response.status, failure.status);
        assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
        assert.equal(response.headers.get("set-cookie"), null);
        const body = await response.json();
        if (failure.code === "username_taken") {
          assert.deepEqual(body, {
            ok: false,
            error: "This username is already taken.",
            code: "username_taken",
          });
        } else {
          assert.deepEqual(body, {
            ok: false,
            error: "Could not create the account.",
            code: "register_failed",
          });
        }
        assert.equal(committedUser, false);
        assert.equal(released, true);
        assert.equal(transactionStatements.at(-1), "ROLLBACK");
        const sessionInsert = transactionStatements.findIndex(
          (sql) => sql.includes("INSERT INTO user_sessions"),
        );
        if (failure.stage === "username" || failure.stage === "user-primary") {
          assert.equal(sessionInsert, -1);
        } else {
          assert.ok(transactionStatements.findIndex(
            (sql) => sql.startsWith("WITH account AS")
              && sql.includes("INSERT INTO player_glicko2_ratings"),
          ) < sessionInsert);
        }
      } finally {
        console.error = originalConsoleError;
      }
    });
  }
});

test("successful login clears the target and every shared-account attempt bucket", async () => {
  const username = "named_player";
  const address = "203.0.113.70";
  const password = "password123";
  const passwordHash = await hashPassword(password);
  const statements: Statement[] = [];
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (
        sql === "BEGIN"
        || sql.startsWith("SET LOCAL")
        || sql === "COMMIT"
        || sql === "ROLLBACK"
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (
        sql.includes("WITH expired_sessions AS MATERIALIZED")
        && sql.includes("DELETE FROM user_sessions AS user_session")
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO user_sessions")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected transaction statement: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("INSERT INTO auth_rate_limits")) {
        return {
          rows: [{
            attempts: 1,
            window_started_at: new Date(),
            blocked_until: null,
            retry_after_seconds: 900,
          }],
        };
      }
      if (sql.includes("FROM users")) {
        return {
          rows: [{
            id: "33333333-3333-4333-8333-333333333333",
            username,
            display_name: "Named Player",
            password_hash: passwordHash,
          }],
        };
      }
      if (sql.startsWith("DELETE FROM auth_rate_limits")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected pool statement: ${sql}`);
    },
    connect: async () => client,
  } as unknown as Pool;

  const response = await withPool(pool, () => login(new NextRequest(
    "https://gostone.test/api/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-real-ip": address },
      body: JSON.stringify({ username, password }),
    },
  )));

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /^gostoned_session=/);
  const deletedKeys = statements
    .filter(({ sql }) => sql.startsWith("DELETE FROM auth_rate_limits"))
    .map(({ values }) => String(values[0]));
  assert.deepEqual(new Set(deletedKeys), new Set([
    createRateLimitKey(
      RATE_LIMIT_POLICIES.loginTarget.scope,
      "ip-subject",
      `${address}\0${username}`,
    ),
    createRateLimitKey(
      RATE_LIMIT_POLICIES.loginAccountBurst.scope,
      "subject",
      username,
    ),
    createRateLimitKey(
      RATE_LIMIT_POLICIES.loginAccountSustained.scope,
      "subject",
      username,
    ),
    createRateLimitKey(
      RATE_LIMIT_POLICIES.loginAccountRecovery.scope,
      "subject",
      username,
    ),
  ]));
});
