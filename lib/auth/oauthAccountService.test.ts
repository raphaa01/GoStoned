import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import { AuthError } from "./accountService";
import {
  beginOAuthSignIn,
  completeOAuthRegistration,
  isOAuthRegistrationTokenFormat,
  type VerifiedOAuthIdentity,
} from "./oauthAccountService";

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

const identity: VerifiedOAuthIdentity = {
  provider: "google",
  subject: "google-subject-123",
  email: "  Player.Name@Example.COM ",
  emailVerified: true,
  displayName: "Provider Display Name",
};

function oauthPool(options: {
  existing?: "confirmed" | "unconfirmed";
  intentUserId?: string | null;
  usernameTaken?: boolean;
} = {}) {
  const statements: Array<{ sql: string; values: readonly unknown[] }> = [];
  let released = false;
  const userId = "88888888-8888-4888-8888-888888888888";
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      const statement = normalized(sql);
      statements.push({ sql: statement, values });
      if (sql === "BEGIN" || sql.startsWith("SET LOCAL") || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (statement.startsWith("SELECT account.id")) {
        return {
          rows: options.existing
            ? [{
                id: userId,
                username: "chosen_player",
                display_name: "Chosen Player",
                avatar_style: "kifu-classic",
                username_confirmed: options.existing === "confirmed",
              }]
            : [],
          rowCount: options.existing ? 1 : 0,
        };
      }
      if (statement.startsWith("UPDATE auth_identities")) return { rows: [], rowCount: 1 };
      if (statement.startsWith("INSERT INTO oauth_registration_intents")) {
        return { rows: [], rowCount: 1 };
      }
      if (statement.startsWith("SELECT provider, provider_subject")) {
        return {
          rows: [{
            provider: "google",
            provider_subject: identity.subject,
            email: "player.name@example.com",
            email_verified: true,
            user_id: options.intentUserId ?? null,
          }],
          rowCount: 1,
        };
      }
      if (statement.startsWith("WITH account AS")) {
        if (options.usernameTaken) {
          throw Object.assign(new Error("duplicate username"), {
            code: "23505",
            constraint: "idx_users_username_lower",
          });
        }
        return {
          rows: [{ id: userId, username: values[0], display_name: values[0], avatar_style: "kifu-classic" }],
          rowCount: 1,
        };
      }
      if (statement.startsWith("UPDATE users")) {
        if (options.usernameTaken) {
          throw Object.assign(new Error("duplicate username"), {
            code: "23505",
            constraint: "idx_users_username_lower",
          });
        }
        return {
          rows: [{ id: userId, username: values[0], display_name: values[0], avatar_style: "kifu-classic" }],
          rowCount: 1,
        };
      }
      if (statement.startsWith("INSERT INTO user_sessions")) return { rows: [], rowCount: 1 };
      if (statement.startsWith("WITH expired_sessions AS MATERIALIZED")) return { rows: [], rowCount: 0 };
      if (statement.startsWith("DELETE FROM oauth_registration_intents WHERE")) {
        return { rows: [], rowCount: 1 };
      }
      if (statement.startsWith("WITH expired_intents AS MATERIALIZED")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected OAuth transaction statement: ${statement}`);
    },
    release() {
      released = true;
    },
  };
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements,
    released: () => released,
    userId,
  };
}

test("a first social sign-in stores only a hashed, expiring registration intent", async () => {
  const database = oauthPool();
  const result = await withPool(database.pool, () => beginOAuthSignIn(identity));

  assert.equal(result.kind, "registration_required");
  if (result.kind !== "registration_required") return;
  assert.equal(isOAuthRegistrationTokenFormat(result.token), true);
  const intentInsert = database.statements.find(({ sql }) => (
    sql.startsWith("INSERT INTO oauth_registration_intents")
  ));
  assert.ok(intentInsert);
  assert.deepEqual(intentInsert.values, [
    createHash("sha256").update(result.token).digest("hex"),
    "google",
    identity.subject,
    "player.name@example.com",
    true,
    null,
  ]);
  assert.equal(
    database.statements.some(({ sql }) => sql.includes("INSERT INTO users")),
    false,
  );
  assert.equal(
    database.statements.some(({ values }) => values.includes(identity.displayName)),
    false,
  );
  assert.equal(database.statements.at(-1)?.sql, "COMMIT");
  assert.equal(database.released(), true);
});

test("an existing social identity signs in without showing username setup again", async () => {
  const database = oauthPool({ existing: "confirmed" });
  const result = await withPool(database.pool, () => beginOAuthSignIn(identity));

  assert.equal(result.kind, "authenticated");
  if (result.kind !== "authenticated") return;
  assert.equal(result.user.username, "chosen_player");
  assert.equal(isOAuthRegistrationTokenFormat(result.token), true);
  assert.equal(
    database.statements.some(({ sql }) => sql.startsWith("INSERT INTO oauth_registration_intents")),
    false,
  );
  assert.equal(
    database.statements.some(({ sql }) => sql.startsWith("INSERT INTO user_sessions")),
    true,
  );
});

test("an account created by the old automatic-name flow must confirm a personal username", async () => {
  const database = oauthPool({ existing: "unconfirmed" });
  const result = await withPool(database.pool, () => beginOAuthSignIn(identity));

  assert.equal(result.kind, "registration_required");
  const intentInsert = database.statements.find(({ sql }) => (
    sql.startsWith("INSERT INTO oauth_registration_intents")
  ));
  assert.ok(intentInsert);
  assert.equal(intentInsert.values.at(-1), database.userId);
  assert.equal(
    database.statements.some(({ sql }) => sql.startsWith("INSERT INTO user_sessions")),
    false,
  );
});

test("username completion creates the account atomically with the player's chosen name", async () => {
  const database = oauthPool();
  const registrationToken = "a".repeat(43);
  const result = await withPool(database.pool, () => completeOAuthRegistration(
    registrationToken,
    "Personal_Name",
    { estimate: "known", knownRank: "5k" },
  ));

  assert.equal(result.user.username, "Personal_Name");
  assert.equal(result.user.displayName, "Personal_Name");
  const accountInsert = database.statements.find(({ sql }) => sql.startsWith("WITH account AS"));
  assert.ok(accountInsert);
  assert.deepEqual(accountInsert.values, [
    "Personal_Name",
    "google",
    identity.subject,
    "player.name@example.com",
    true,
    "known",
    "5k",
    "starting-strength-v1",
    1750,
    350,
    0.06,
    "glicko2-v1-tau-0.5",
  ]);
  assert.equal(
    database.statements.some(({ sql }) => sql.startsWith("DELETE FROM oauth_registration_intents WHERE")),
    true,
  );
  assert.equal(database.statements.at(-1)?.sql, "COMMIT");
  assert.equal(database.released(), true);
});

test("username completion upgrades an existing generated OAuth account in place", async () => {
  const database = oauthPool({ intentUserId: "88888888-8888-4888-8888-888888888888" });
  const result = await withPool(database.pool, () => completeOAuthRegistration(
    "c".repeat(43),
    "Actually_Personal",
    { estimate: "unspecified", knownRank: null },
  ));

  assert.equal(result.user.id, database.userId);
  assert.equal(result.user.username, "Actually_Personal");
  assert.equal(
    database.statements.some(({ sql }) => sql.startsWith("UPDATE users")),
    true,
  );
  assert.equal(
    database.statements.some(({ sql }) => sql.startsWith("WITH account AS")),
    false,
  );
  const identityUpdate = database.statements.find(({ sql }) => (
    sql.startsWith("UPDATE auth_identities")
  ));
  assert.ok(identityUpdate);
  assert.match(identityUpdate.sql, /username_confirmed = true/);
  assert.equal(database.statements.at(-1)?.sql, "COMMIT");
});

test("a taken username rolls back without consuming the verified registration intent", async () => {
  const database = oauthPool({ usernameTaken: true });
  await assert.rejects(
    withPool(database.pool, () => completeOAuthRegistration(
      "b".repeat(43),
      "taken_player",
      { estimate: "unspecified", knownRank: null },
    )),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, "username_taken");
      return true;
    },
  );

  assert.equal(
    database.statements.some(({ sql }) => sql.startsWith("DELETE FROM oauth_registration_intents WHERE")),
    false,
  );
  assert.equal(database.statements.at(-1)?.sql, "ROLLBACK");
  assert.equal(database.released(), true);
});

test("invalid or expired registration tokens fail before an account is created", async () => {
  const database = oauthPool();
  await assert.rejects(
    withPool(database.pool, () => completeOAuthRegistration(
      "not-a-valid-token",
      "valid_player",
      { estimate: "unspecified", knownRank: null },
    )),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, "oauth_registration_expired");
      return true;
    },
  );
  assert.deepEqual(database.statements, []);
});
