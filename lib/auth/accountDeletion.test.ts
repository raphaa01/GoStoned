import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { GET, POST } from "@/app/api/account/deletion-request/route";
import { ACCOUNT_DELETION_DAYS, parseAccountDeletionRequest } from "./accountDeletionContract";
import { DELETION_RECEIPT_COOKIE, getAccountDeletionReceipt, requestAccountDeletion } from "./accountDeletionService";
import { SESSION_COOKIE } from "./session";
import { GUEST_SESSION_COOKIE } from "./guestSession";
import { EXPECTED_PLAYER_HEADER } from "./playerBinding";

const identity = "12345678-1234-1234-1234-123456789abc";
const receiptRow = {
  id: "abcdefgh", status: "pending", requested_at: new Date("2026-10-06T12:00:00Z"),
  due_at: new Date("2026-10-13T12:00:00Z"), completed_at: null,
};
type Statement = { sql: string; values: readonly unknown[] };

async function database<T>(action: (statements: Statement[]) => Promise<T>, options: { guest?: boolean; completed?: boolean; expired?: boolean; incomplete?: boolean; failErase?: boolean } = {}) {
  const previousPool = globalThis.goStonedDbPool;
  const statements: Statement[] = [];
  const executor = {
    async query(sql: string, values: readonly unknown[] = []) {
      statements.push({ sql, values });
      if (sql.includes("INSERT INTO auth_rate_limits")) return { rows: [{ attempts: 1, window_started_at: new Date(), blocked_until: null, retry_after_seconds: 1 }] };
      if (sql.includes("FROM user_sessions s")) return { rows: options.expired ? [] : [{ id: identity, username: "test_player", display_name: null, email_required: options.incomplete }] };
      if (sql.includes("FROM guest_sessions")) return { rows: options.guest ? [{ guest_id: identity }] : [] };
      if (sql.includes("SELECT id FROM users") || sql.includes("SELECT guest_id FROM guest_sessions")) return { rows: [{ id: identity }] };
      if (sql.includes("DELETE FROM users") && options.failErase) throw new Error("Simulated erasure failure");
      if (sql.includes("account_deletion_requests")) return { rows: [{ ...receiptRow, status: (options.completed || sql.startsWith("UPDATE")) ? "completed" : "pending", completed_at: (options.completed || sql.startsWith("UPDATE")) ? new Date("2026-10-07T12:00:00Z") : null }] };
      if (sql.startsWith("DELETE") || ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.startsWith("SET ") || sql.includes("FROM games") || sql.includes("FROM auth_identities identity")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  globalThis.goStonedDbPool = { ...executor, async connect() { return { ...executor, release() {} }; } } as unknown as Pool;
  try { return await action(statements); }
  finally {
    globalThis.goStonedDbPool = previousPool;
  }
}

function request(body = { confirmed: true, email: "" }, headers: Record<string, string> = {}, method = "POST") {
  return new NextRequest("https://gostone.test/api/account/deletion-request", {
    method, headers: { "Content-Type": "application/json", "x-real-ip": "203.0.113.240", ...headers },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

test("deletion requires explicit consent, an optional valid email, and no identity supplied by the caller", () => {
  assert.equal(ACCOUNT_DELETION_DAYS, 7);
  assert.deepEqual(parseAccountDeletionRequest({ confirmed: true }), { email: null });
  assert.deepEqual(parseAccountDeletionRequest({ confirmed: true, email: "" }), { email: null });
  assert.deepEqual(parseAccountDeletionRequest({ confirmed: true, email: " person@example.test " }), { email: "person@example.test" });
  for (const body of [
    { confirmed: false, email: "" }, { confirmed: true, email: "not-email" },
    { confirmed: true, email: "x".repeat(321) }, { confirmed: true, email: "", playerKey: "user:other" },
  ]) assert.throws(() => parseAccountDeletionRequest(body));
});

test("erasure commits before issuing a de-identified receipt and stores no optional contact", async () => {
  await database(async (statements) => {
    const result = await requestAccountDeletion(`user:${identity}`);
    assert.equal(result.request.dueAt, "2026-10-13T12:00:00.000Z");
    const insert = statements.find(({ sql }) => sql.includes("INSERT INTO account_deletion_requests"))!;
    assert.match(insert.sql, /ON CONFLICT \(player_key\) WHERE status <> 'completed'/);
    assert.match(insert.sql, /DO UPDATE SET receipt_hash = EXCLUDED.receipt_hash\s+RETURNING/);
    assert.deepEqual(insert.values, [`user:${identity}`, null, createHash("sha256").update(result.token).digest("hex"), 7]);
    assert.equal(result.request.status, "completed");
    assert.ok(statements.findIndex(({ sql }) => sql.includes("DELETE FROM users")) < statements.indexOf(insert));
    assert.equal(statements.at(-1)?.sql, "COMMIT");
    assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(JSON.stringify(result.request).includes(identity), false);
  });
});

test("invalid receipt tokens never reach the database", async () => {
  await database(async (statements) => {
    for (const token of [undefined, "", "guess", "x".repeat(200)]) assert.equal(await getAccountDeletionReceipt(token), null);
    assert.equal(statements.length, 0);
  });
});

test("cross-site deletion submissions are rejected before database work", async () => {
  await database(async (statements) => {
    const response = await POST(request(undefined, { Origin: "https://attacker.example" }));
    assert.equal(response.status, 403);
    assert.equal(statements.length, 0);
  });
});

test("an authenticated account or guest can submit only its own request", async () => {
  for (const guest of [false, true]) await database(async (statements) => {
    const cookie = `${guest ? GUEST_SESSION_COOKIE : SESSION_COOKIE}=${"a".repeat(43)}`;
    const response = await POST(request(undefined, { Cookie: cookie }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
    assert.match(response.headers.get("set-cookie") ?? "", /Path=\/api\/account\/deletion-request/);
    const insert = statements.find(({ sql }) => sql.includes("INSERT INTO account_deletion_requests"))!;
    assert.equal(insert.values[0], `${guest ? "guest" : "user"}:${identity}`);
    const body = await response.json();
    assert.equal(body.request.status, "completed");
    assert.match(response.headers.get("set-cookie") ?? "", /gostoned_session=;.*Max-Age=0/);
    assert.equal(JSON.stringify(body).includes(insert.values[2] as string), false);
  }, { guest });
});

test("missing or expired account sessions cannot submit on behalf of a guest", async () => {
  await database(async (statements) => {
    const response = await POST(request(undefined, { Cookie: `${SESSION_COOKIE}=${"a".repeat(43)}; ${GUEST_SESSION_COOKIE}=${"b".repeat(43)}` }));
    assert.equal(response.status, 401);
    assert.equal(statements.some(({ sql }) => sql.includes("INSERT INTO account_deletion_requests")), false);
  }, { guest: true, expired: true });
});

test("a private completion receipt is readable after authentication is removed", async () => {
  await database(async () => {
    const response = await GET(request(undefined, { Cookie: `${DELETION_RECEIPT_COOKIE}=${"b".repeat(43)}` }, "GET"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.hasIdentity, false);
    assert.equal(body.request.status, "completed");
    assert.equal(body.request.completedAt, "2026-10-07T12:00:00.000Z");
    assert.equal("playerKey" in body.request, false);
    assert.equal("email" in body.request, false);
  }, { completed: true });
});


test("legacy accounts can delete without adding an email or password", async () => {
  await database(async statements => {
    const response = await POST(request({ confirmed: true } as never, { Cookie: `${SESSION_COOKIE}=${"a".repeat(43)}`, "x-gostone-account-security": "2" }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).request.status, "completed");
    assert.ok(statements.some(({ sql }) => sql.includes("DELETE FROM users")));
  }, { incomplete: true });
});

test("failed erasure rolls back and never returns a completion receipt", async () => {
  await database(async statements => {
    await assert.rejects(requestAccountDeletion(`user:${identity}`));
    assert.equal(statements.at(-1)?.sql, "ROLLBACK");
    assert.equal(statements.some(({ sql }) => sql === "COMMIT" || sql.includes("INSERT INTO account_deletion_requests")), false);
  }, { failErase: true });
});

test("a switched account cannot be erased using another account's confirmation", async () => {
  await database(async statements => {
    const response = await POST(request(undefined, { Cookie: `${SESSION_COOKIE}=${"a".repeat(43)}`,
      [EXPECTED_PLAYER_HEADER]: "user:another-account" }));
    assert.equal(response.status, 409);
    assert.equal(statements.some(({ sql }) => sql.includes("DELETE FROM users") || sql === "BEGIN"), false);
  });
});
