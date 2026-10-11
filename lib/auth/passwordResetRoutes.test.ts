import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { POST } from "@/app/api/auth/password-reset/route";
import { sendPasswordResetEmail } from "./resetEmail";
import { createSession } from "./session";

test("reset transport uses the verified server domain and rejects provider failures without exposing payloads", async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousDomain = process.env.RESEND_EMAIL_DOMAIN;
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_EMAIL_DOMAIN = "gostone.app";
  try {
    await sendPasswordResetEmail("player@example.test", "12345678", async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.from, "GoStone <security@gostone.app>");
      assert.deepEqual(body.to, ["player@example.test"]);
      assert.match(body.text, /12345678/);
      assert.match(new Headers(options?.headers).get("Idempotency-Key")!, /^password-reset\//);
      return Response.json({ id: "accepted" });
    });
    await assert.rejects(sendPasswordResetEmail("player@example.test", "12345678", async () =>
      Response.json({ message: "private provider payload" }, { status: 403 })), /not accepted/);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
    if (previousDomain === undefined) delete process.env.RESEND_EMAIL_DOMAIN; else process.env.RESEND_EMAIL_DOMAIN = previousDomain;
  }
});

test("reset API enforces origin, bounded shape, address limits and code validity before password changes", async () => {
  const previous = globalThis.goStonedDbPool;
  const statements: string[] = [];
  globalThis.goStonedDbPool = { query: async (sql: string) => {
    statements.push(sql);
    return { rows: [{ attempts: 1, blocked_until: null, retry_after_seconds: 1 }] };
  } } as unknown as Pool;
  try {
    const call = (body: unknown, origin?: string) => POST(new NextRequest("https://gostone.test/api/auth/password-reset", {
      method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
    }));
    assert.equal((await call({ action: "request", email: "player@example.test" }, "https://attacker.test")).status, 403);
    assert.equal(statements.length, 0);
    assert.equal((await call({ action: "request", email: "invalid" })).status, 400);
    assert.equal((await call({ action: "request", email: "player@example.test", extra: true })).status, 400);
    const invalidCode = await call({ action: "reset", email: "player@example.test", code: "123", password: "password123" });
    assert.equal(invalidCode.status, 400);
    assert.equal((await invalidCode.json()).code, "invalid_reset_code");
    assert.ok(statements.every(sql => sql.includes("auth_rate_limits")));
  } finally { globalThis.goStonedDbPool = previous; }
});

test("an old-password login cannot issue a session after a password reset", async () => {
  const previous = globalThis.goStonedDbPool;
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.startsWith("SELECT password_hash")) return { rows: [{ password_hash: null }] };
      return { rows: [] };
    }, release() {},
  };
  globalThis.goStonedDbPool = { connect: async () => client } as unknown as Pool;
  try {
    await assert.rejects(createSession("11111111-1111-4111-8111-111111111111", "old-password"), { code: "invalid_credentials" });
    assert.ok(statements.some(sql => sql.includes("FOR UPDATE")));
    assert.equal(statements.at(-1), "ROLLBACK");
    assert.equal(statements.some(sql => sql.includes("INSERT INTO user_sessions")), false);
  } finally { globalThis.goStonedDbPool = previous; }
});
