import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Pool } from "pg";
import { AuthError, registerAccount } from "./accountService";
import { isSessionTokenFormat } from "./session";

type FailureStage = "username" | "session" | "cleanup" | "commit-rejected";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

function registrationPool(options: {
  failAt?: FailureStage;
  usernameConstraint?: string;
  commitGate?: Deferred;
  commitEntered?: Deferred;
} = {}) {
  const statements: Array<{ sql: string; values: readonly unknown[] }> = [];
  const committedUsers = new Set<string>();
  let stagedUsername: string | null = null;
  let released = false;
  const userId = "77777777-7777-4777-8777-777777777777";
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql: normalized(sql), values });
      if (sql === "BEGIN" || sql.startsWith("SET LOCAL")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO users")) {
        if (options.failAt === "username") {
          throw Object.assign(new Error("unique user conflict"), {
            code: "23505",
            constraint: options.usernameConstraint ?? "users_username_key",
          });
        }
        stagedUsername = String(values[0]);
        return {
          rows: [{ id: userId, username: values[0], display_name: values[0] }],
          rowCount: 1,
        };
      }
      if (sql.includes("INSERT INTO user_sessions")) {
        if (options.failAt === "session") {
          throw Object.assign(new Error("duplicate session token"), { code: "23505" });
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("WITH expired_sessions AS MATERIALIZED")) {
        if (options.failAt === "cleanup") throw new Error("cleanup failed");
        return { rows: [], rowCount: 0 };
      }
      if (sql === "COMMIT") {
        options.commitEntered?.resolve();
        if (options.commitGate) await options.commitGate.promise;
        // This models a database-confirmed rejection. A connection loss after
        // COMMIT has an inherently ambiguous outcome and is not simulated here.
        if (options.failAt === "commit-rejected") throw new Error("commit rejected");
        if (stagedUsername) committedUsers.add(stagedUsername);
        return { rows: [], rowCount: 0 };
      }
      if (sql === "ROLLBACK") {
        stagedUsername = null;
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected transaction statement: ${sql}`);
    },
    release() {
      released = true;
    },
  };
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements,
    committedUsers,
    released: () => released,
    userId,
  };
}

test("registration commits the user, session, and bounded cleanup before exposing credentials", async () => {
  const commitGate = deferred();
  const commitEntered = deferred();
  const database = registrationPool({ commitGate, commitEntered });
  let registrationSettled = false;

  const registration = withPool(database.pool, () => registerAccount(
    "atomic_player",
    "password123",
  ));
  registration.then(() => {
    registrationSettled = true;
  });
  await commitEntered.promise;
  await Promise.resolve();

  assert.equal(registrationSettled, false);
  assert.equal(database.committedUsers.size, 0);
  commitGate.resolve();
  const result = await registration;

  assert.equal(database.released(), true);
  assert.deepEqual(result.user, {
    id: database.userId,
    username: "atomic_player",
    displayName: "atomic_player",
    playerKey: `user:${database.userId}`,
  });
  assert.equal(isSessionTokenFormat(result.token), true);
  assert.deepEqual(database.committedUsers, new Set(["atomic_player"]));
  assert.deepEqual(database.statements.map(({ sql }) => (
    sql.startsWith("WITH account AS") ? "CREATE ACCOUNT WITH GLOBAL RATING" : sql
  )), [
    "BEGIN",
    "SET LOCAL statement_timeout = '8s'",
    "CREATE ACCOUNT WITH GLOBAL RATING",
    "INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')",
    "WITH expired_sessions AS MATERIALIZED ( SELECT user_session.id FROM user_sessions AS user_session WHERE user_session.expires_at <= NOW() ORDER BY user_session.expires_at, user_session.id LIMIT 200 FOR UPDATE OF user_session SKIP LOCKED ) DELETE FROM user_sessions AS user_session USING expired_sessions AS expired WHERE user_session.id = expired.id",
    "COMMIT",
  ]);
  assert.match(String(database.statements[2].values[1]), /^scrypt\$/);
  assert.deepEqual(database.statements[2].values.slice(2), [
    "unspecified",
    null,
    "starting-strength-v1",
    1200,
    350,
    0.06,
    "glicko2-v1-tau-0.5",
  ]);
  assert.deepEqual(database.statements[3].values, [
    database.userId,
    createHash("sha256").update(result.token).digest("hex"),
  ]);
});

test("only a unique violation from the user insert maps to username_taken", async () => {
  for (const constraint of ["users_username_key", "idx_users_username_lower"]) {
    const duplicate = registrationPool({ failAt: "username", usernameConstraint: constraint });
    await assert.rejects(
      withPool(duplicate.pool, () => registerAccount("taken_player", "password123")),
      (error: unknown) => {
        assert.ok(error instanceof AuthError);
        assert.equal(error.code, "username_taken");
        return true;
      },
    );

    assert.equal(duplicate.committedUsers.size, 0);
    assert.equal(
      duplicate.statements.some(({ sql }) => sql.includes("INSERT INTO user_sessions")),
      false,
    );
    assert.equal(duplicate.statements.at(-1)?.sql, "ROLLBACK");
  }

  const primaryKeyCollision = registrationPool({
    failAt: "username",
    usernameConstraint: "users_pkey",
  });
  await assert.rejects(
    withPool(primaryKeyCollision.pool, () => registerAccount("new_player", "password123")),
    (error: unknown) => {
      assert.equal(error instanceof AuthError, false);
      assert.match(String(error), /unique user conflict/);
      return true;
    },
  );
  assert.equal(primaryKeyCollision.committedUsers.size, 0);
  assert.equal(primaryKeyCollision.statements.at(-1)?.sql, "ROLLBACK");

  const sessionCollision = registrationPool({ failAt: "session" });
  await assert.rejects(
    withPool(sessionCollision.pool, () => registerAccount("new_player", "password123")),
    (error: unknown) => {
      assert.equal(error instanceof AuthError, false);
      assert.match(String(error), /duplicate session token/);
      return true;
    },
  );
  assert.equal(sessionCollision.committedUsers.size, 0);
  assert.equal(sessionCollision.statements.at(-1)?.sql, "ROLLBACK");
});

test("session cleanup and deterministic commit rejection roll back the new user", async (t) => {
  for (const stage of ["cleanup", "commit-rejected"] as const) {
    await t.test(stage, async () => {
      const database = registrationPool({ failAt: stage });
      await assert.rejects(
        withPool(database.pool, () => registerAccount(`${stage}_player`, "password123")),
        stage === "cleanup" ? /cleanup failed/ : /commit rejected/,
      );

      assert.equal(database.committedUsers.size, 0);
      assert.equal(database.statements.at(-1)?.sql, "ROLLBACK");
      assert.equal(database.released(), true);
      assert.equal(
        database.statements.some(({ sql }) => sql.includes("INSERT INTO users")),
        true,
      );
    });
  }
});

test("production preflight requires the existing users RLS boundary", async () => {
  const [schema, migration, preflight] = await Promise.all([
    readFile(new URL("../../db/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../../db/migrations/002_live_games.sql", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/check-mvp.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [schema, migration]) {
    assert.match(source, /ALTER TABLE users ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /REVOKE ALL ON [^;]*\busers\b[^;]* FROM anon/);
    assert.match(source, /REVOKE ALL ON [^;]*\busers\b[^;]* FROM authenticated/);
  }
  assert.match(
    preflight,
    /const requiredProtectedTables = \[\s*"users",\s*"user_sessions",/,
  );
});
