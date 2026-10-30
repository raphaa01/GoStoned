import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { decryptAppleToken, encryptAppleToken, revokeAppleToken } from "./oauth";

test("Apple credentials are encrypted, authenticated and bound to their owner; revocation stays server-side", async () => {
  const previous = { key: process.env.APPLE_PRIVATE_KEY, id: process.env.APPLE_CLIENT_ID,
    team: process.env.APPLE_TEAM_ID, kid: process.env.APPLE_KEY_ID, fetch: globalThis.fetch };
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  process.env.APPLE_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  process.env.APPLE_CLIENT_ID = "test-client";
  process.env.APPLE_TEAM_ID = "test-team";
  process.env.APPLE_KEY_ID = "test-key";
  try {
    const token = "test-refresh-credential";
    const encrypted = encryptAppleToken("owner", token);
    assert.equal(encrypted.includes(token), false);
    assert.notEqual(encryptAppleToken("owner", token), encrypted);
    assert.equal(decryptAppleToken("owner", encrypted), token);
    assert.throws(() => decryptAppleToken("different-owner", encrypted));
    assert.throws(() => decryptAppleToken("owner", encrypted.replace(/^./, encrypted[0] === "a" ? "b" : "a")));
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      calls++;
      assert.equal(input, "https://appleid.apple.com/auth/revoke");
      assert.equal(init?.method, "POST");
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("token"), token);
      assert.equal(body.get("client_id"), "test-client");
      assert.equal(body.get("token_type_hint"), "refresh_token");
      return new Response(null, { status: calls === 1 ? 200 : 503 });
    };
    await revokeAppleToken("owner", encrypted);
    await assert.rejects(revokeAppleToken("owner", encrypted), { message: "Apple authorization revocation failed." });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of Object.entries({ APPLE_PRIVATE_KEY: previous.key, APPLE_CLIENT_ID: previous.id,
      APPLE_TEAM_ID: previous.team, APPLE_KEY_ID: previous.kid })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
