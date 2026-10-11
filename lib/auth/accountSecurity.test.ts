import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { NextRequest } from "next/server";
import { normalizeEmail, requireEmail } from "./email";
import { AuthError, registrationDatabaseError } from "./accountService";
import { assertAccountEmailComplete, resolvePlayerKey } from "./requestAuth";
import { serializeAuthUser } from "./types";
import { readCredentialRequest, readRegistrationRequest } from "./credentialRequest";
import { hashPassword } from "./password";
import { resetAccountPassword, requestPasswordReset } from "./passwordResetService";

const account = { id: "11111111-1111-4111-8111-111111111111", username: "player", display_name: "Player" };

test("email normalization preserves aliases and rejects malformed or oversized addresses", () => {
  assert.equal(normalizeEmail("  Player+go@Example.COM "), "player+go@example.com");
  assert.equal(normalizeEmail("p.l.a.y.e.r@gmail.com"), "p.l.a.y.e.r@gmail.com");
  for (const value of [null, "", "player", "p@localhost", "p\n@example.com", ".p@example.com", "p..q@example.com", "p@-example.com", `${"p".repeat(65)}@example.com`]) {
    assert.equal(normalizeEmail(value), null);
    assert.throws(() => requireEmail(value), (error) => error instanceof AuthError && error.code === "invalid_email");
  }
  assert.equal(registrationDatabaseError({ code: "23505", constraint: "idx_users_email_lower" })?.code, "email_taken");
});

function request(body: unknown) {
  return new NextRequest("https://gostone.test/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://gostone.test" }, body: JSON.stringify(body),
  });
}

test("login accepts email and legacy usernames; password registration requires email", async () => {
  assert.deepEqual(await readCredentialRequest(request({ username: " Player@EXAMPLE.com ", password: "password123" })),
    { username: "player@example.com", password: "password123" });
  assert.deepEqual(await readCredentialRequest(request({ username: " Player_Name ", password: "password123" })),
    { username: "Player_Name", password: "password123" });
  const fields = { username: "player", password: "password123", startingStrength: "unspecified", knownRank: null, boardPlacement: "zoom" };
  await assert.rejects(readRegistrationRequest(request(fields)), (error) => error instanceof AuthError && error.code === "invalid_request");
  await assert.rejects(readRegistrationRequest(request({ ...fields, email: "invalid" })), (error) => error instanceof AuthError && error.code === "invalid_email");
  assert.equal((await readRegistrationRequest(request({ ...fields, email: " Player@Example.com " }))).email, "player@example.com");
});

test("incomplete accounts cannot use a player session or fall back to a guest", async () => {
  const user = serializeAuthUser({ ...account, email_required: true });
  assert.equal(user.emailRequired, true);
  assert.throws(() => assertAccountEmailComplete(user), { code: "email_required", status: 403 });
  assert.doesNotThrow(() => assertAccountEmailComplete(serializeAuthUser({ ...account, email_required: false })));
  const req = new NextRequest("https://gostone.test/api/matchmaking", { headers: { Cookie: `gostoned_session=${"a".repeat(43)}`, "sec-fetch-site": "same-origin" } });
  await assert.rejects(resolvePlayerKey(req, {
    getAccount: async () => user,
    getGuest: async () => { throw new Error("Must not resolve a guest"); },
  }), { code: "email_required", status: 403 });
});

async function withDatabase<T>(client: object, action: () => Promise<T>) {
  const previous = globalThis.goStonedDbPool;
  globalThis.goStonedDbPool = { connect: async () => client, query: (client as { query: (...args: unknown[]) => unknown }).query } as unknown as Pool;
  try { return await action(); } finally { globalThis.goStonedDbPool = previous; }
}

test("a wrong reset code commits the failure budget; a correct one consumes the code and revokes sessions", async () => {
  const codeHash = await hashPassword("12345678");
  for (const code of ["87654321", "12345678"]) {
    const statements: string[] = [];
    const client = {
      async query(sql: string) {
        statements.push(sql);
        if (sql.startsWith("SELECT id FROM users")) return { rows: [{ id: account.id }] };
        if (sql.startsWith("SELECT code_hash")) return { rows: [{ code_hash: codeHash }] };
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    await withDatabase(client, async () => {
      if (code === "87654321") {
        await assert.rejects(resetAccountPassword("player@example.com", code, "replacement123"), { code: "invalid_reset_code" });
        assert.ok(statements.some((sql) => sql.includes("attempts = attempts + 1")));
        assert.equal(statements.some((sql) => sql.startsWith("UPDATE users")), false);
      } else {
        await resetAccountPassword("player@example.com", code, "replacement123");
        assert.ok(statements.some((sql) => sql.startsWith("UPDATE users")));
        assert.ok(statements.some((sql) => sql.startsWith("DELETE FROM password_reset_codes")));
        assert.ok(statements.some((sql) => sql.startsWith("DELETE FROM user_sessions")));
      }
      assert.equal(statements.at(-1), "COMMIT");
    });
  }
});

test("missing, expired, exhausted, or already used codes never update a password", async () => {
  const statements: string[] = [];
  await withDatabase({
    async query(sql: string) {
      statements.push(sql);
      if (sql.startsWith("SELECT id FROM users")) return { rows: [{ id: account.id }] };
      return { rows: [], rowCount: 0 };
    }, release() {},
  }, () => assert.rejects(resetAccountPassword("player@example.com", "12345678", "replacement123"), { code: "invalid_reset_code" }));
  assert.equal(statements.some((sql) => sql.startsWith("UPDATE users")), false);
});

test("reset requests do not send email for missing or social-only accounts", async () => {
  await withDatabase({
    async query() { return { rows: [], rowCount: 0 }; }, release() {},
  }, () => requestPasswordReset("player@example.com", async () => { assert.fail("Must not send"); }));
});
