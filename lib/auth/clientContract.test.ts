import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { NextRequest } from "next/server";
import { usesLegacyAccountContract, ACCOUNT_SECURITY_HEADER } from "./clientContract";
import { readRegistrationRequest } from "./credentialRequest";
import { getRequestUser, resolvePlayerKey } from "./requestAuth";

const url = "https://gostone.test/api/auth/register";
const oldFields = { username: "old_app_player", password: "password123", startingStrength: "unspecified", knownRank: null, boardPlacement: "zoom" };
const legacyHeaders: Record<string, string>[] = [{}, { Origin: "capacitor://localhost" }, { Origin: "https://localhost" }];
const currentHeaders: Record<string, string>[] = [
  { Origin: "https://gostone.test" }, { "sec-fetch-site": "same-origin" },
  { Origin: "capacitor://localhost", [ACCOUNT_SECURITY_HEADER]: "2" },
  { [ACCOUNT_SECURITY_HEADER]: "2" }, { [ACCOUNT_SECURITY_HEADER]: "unknown" },
];

test("released native HTTP and WebView contracts remain compatible; web and upgraded clients require email", async () => {
  for (const headers of legacyHeaders) {
    const request = new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(oldFields) });
    assert.equal(usesLegacyAccountContract(request), true);
    assert.equal((await readRegistrationRequest(request)).email, null);
  }
  for (const headers of currentHeaders) {
    const request = new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(oldFields) });
    assert.equal(usesLegacyAccountContract(request), false);
    await assert.rejects(readRegistrationRequest(request), { code: "invalid_request" });
  }
  const malformed = new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...oldFields, email: "invalid" }) });
  await assert.rejects(readRegistrationRequest(malformed), { code: "invalid_email" });
});

test("old installed apps retain authenticated access; browsers and upgraded apps receive the mandatory email restriction", async () => {
  const previous = globalThis.goStonedDbPool;
  const id = "11111111-1111-4111-8111-111111111111";
  globalThis.goStonedDbPool = { query: async () => ({ rows: [{ id, username: "legacy", display_name: "Legacy", email_required: true, expires_at: new Date(Date.now() + 60_000) }] }) } as unknown as Pool;
  try {
    for (const headers of legacyHeaders) {
      const request = new NextRequest(url, { headers: { Cookie: `gostoned_session=${"a".repeat(43)}`, ...headers } });
      assert.equal((await getRequestUser(request))?.id, id);
      assert.equal((await getRequestUser(request))?.emailRequired, true);
      assert.equal(await resolvePlayerKey(request), `user:${id}`);
    }
    for (const headers of currentHeaders) {
      const request = new NextRequest(url, { headers: { Cookie: `gostoned_session=${"a".repeat(43)}`, ...headers } });
      await assert.rejects(getRequestUser(request), { code: "email_required", status: 403 });
      await assert.rejects(resolvePlayerKey(request), { code: "email_required", status: 403 });
      assert.equal((await getRequestUser(request, { allowIncomplete: true }))?.id, id);
    }
    globalThis.goStonedDbPool = { query: async () => ({ rows: [] }) } as unknown as Pool;
    assert.equal(await getRequestUser(new NextRequest(url)), null);
    await assert.rejects(resolvePlayerKey(new NextRequest(url, { headers: { Cookie: `gostoned_session=${"a".repeat(43)}` } })), { code: "session_expired", status: 401 });
  } finally { globalThis.goStonedDbPool = previous; }
});
