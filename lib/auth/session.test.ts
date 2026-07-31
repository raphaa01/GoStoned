import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Pool } from "pg";
import { createSession, isSessionTokenFormat } from "./session";

type Statement = { sql: string; values: readonly unknown[] };

function normalized(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

async function withPool<T>(pool: Pool, action: () => Promise<T>): Promise<T> {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = pool;
  try {
    return await action();
  } finally {
    globalThis.goStonedDbPool = previous;
  }
}

test("registered-session creation bounds deterministic expired-row cleanup in its transaction", async () => {
  const statements: Statement[] = [];
  let released = false;
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  } as unknown as Pool;
  const userId = "11111111-1111-4111-8111-111111111111";

  const token = await withPool(pool, () => createSession(userId));

  assert.equal(isSessionTokenFormat(token), true);
  assert.equal(released, true);
  assert.deepEqual(statements.map(({ sql }) => normalized(sql)), [
    "BEGIN",
    "SET LOCAL statement_timeout = '8s'",
    "INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')",
    "WITH expired_sessions AS MATERIALIZED ( SELECT user_session.id FROM user_sessions AS user_session WHERE user_session.expires_at <= NOW() ORDER BY user_session.expires_at, user_session.id LIMIT 200 FOR UPDATE OF user_session SKIP LOCKED ) DELETE FROM user_sessions AS user_session USING expired_sessions AS expired WHERE user_session.id = expired.id",
    "COMMIT",
  ]);
  assert.deepEqual(statements[2].values, [
    userId,
    createHash("sha256").update(token).digest("hex"),
  ]);
  assert.deepEqual(statements[3].values, []);
  assert.equal(
    statements.some(({ sql }) => normalized(sql) === "DELETE FROM user_sessions WHERE expires_at <= NOW()"),
    false,
  );
});

test("registered-session insert failure rolls back before expiry cleanup", async () => {
  const statements: Statement[] = [];
  let released = false;
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("INSERT INTO user_sessions")) throw new Error("insert failed");
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  } as unknown as Pool;

  await assert.rejects(
    withPool(pool, () => createSession("22222222-2222-4222-8222-222222222222")),
    /insert failed/,
  );

  assert.equal(released, true);
  assert.deepEqual(statements.map(({ sql }) => normalized(sql)), [
    "BEGIN",
    "SET LOCAL statement_timeout = '8s'",
    "INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')",
    "ROLLBACK",
  ]);
  assert.equal(
    statements.some(({ sql }) => sql.includes("WITH expired_sessions AS MATERIALIZED")),
    false,
  );
});

test("registered-session cleanup failure rolls back the inserted session", async () => {
  const statements: Statement[] = [];
  let released = false;
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("WITH expired_sessions AS MATERIALIZED")) {
        throw new Error("cleanup failed");
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  } as unknown as Pool;

  await assert.rejects(
    withPool(pool, () => createSession("33333333-3333-4333-8333-333333333333")),
    /cleanup failed/,
  );

  assert.equal(released, true);
  assert.deepEqual(statements.map(({ sql }) => normalized(sql)), [
    "BEGIN",
    "SET LOCAL statement_timeout = '8s'",
    "INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')",
    "WITH expired_sessions AS MATERIALIZED ( SELECT user_session.id FROM user_sessions AS user_session WHERE user_session.expires_at <= NOW() ORDER BY user_session.expires_at, user_session.id LIMIT 200 FOR UPDATE OF user_session SKIP LOCKED ) DELETE FROM user_sessions AS user_session USING expired_sessions AS expired WHERE user_session.id = expired.id",
    "ROLLBACK",
  ]);
  assert.equal(statements.some(({ sql }) => sql === "COMMIT"), false);
});

test("registered-session expiry cleanup retains its existing indexed preflight contract", async () => {
  const [schema, migration, preflight] = await Promise.all([
    readFile(new URL("../../db/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../../db/migrations/004_accounts_and_chat.sql", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/check-mvp.ts", import.meta.url), "utf8"),
  ]);
  const index = /CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at\s+ON user_sessions\(expires_at\)/;

  assert.match(schema, index);
  assert.match(migration, index);
  assert.match(schema, /ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY/);
  assert.match(
    preflight,
    /idx_user_sessions_expires_at:\s*\[\s*"ON public\.user_sessions USING btree \(expires_at\)",?\s*\]/,
  );
  assert.match(
    preflight,
    /const requiredProtectedTables = \[\s*"users",\s*"user_sessions",/,
  );
});
