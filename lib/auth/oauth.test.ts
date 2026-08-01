import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as oauthCallback } from "@/app/api/auth/oauth/[provider]/callback/route";
import { GET as startOAuth } from "@/app/api/auth/oauth/[provider]/route";
import {
  oauthTransactionCookie,
  parseOAuthTransaction,
  serializeOAuthTransaction,
  type OAuthTransaction,
} from "./oauth";
import { socialUsername, type VerifiedOAuthIdentity } from "./oauthAccountService";

async function withEnvironment<T>(
  values: Record<string, string | undefined>,
  action: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await action();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Google sign-in starts with state, PKCE, and an HttpOnly transaction cookie", async () => {
  await withEnvironment({
    NEXT_PUBLIC_APP_URL: "https://gostone.test",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
  }, async () => {
    const response = await startOAuth(
      new NextRequest("https://gostone.test/api/auth/oauth/google?mode=register&locale=de"),
      { params: Promise.resolve({ provider: "google" }) },
    );
    assert.equal(response.status, 307);
    const authorization = new URL(response.headers.get("location") ?? "");
    assert.equal(authorization.origin, "https://accounts.google.com");
    assert.equal(authorization.searchParams.get("client_id"), "google-client-id");
    assert.equal(authorization.searchParams.get("response_type"), "code");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");

    const cookieName = oauthTransactionCookie("google");
    const cookie = response.cookies.get(cookieName)?.value;
    const transaction = parseOAuthTransaction(cookie);
    assert.ok(transaction);
    assert.equal(transaction.mode, "register");
    assert.equal(transaction.locale, "de");
    assert.equal(transaction.returnTo, null);
    assert.equal(authorization.searchParams.get("state"), transaction.state);
    assert.equal(
      authorization.searchParams.get("code_challenge"),
      createHash("sha256").update(transaction.codeVerifier as string).digest("base64url"),
    );
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(response.headers.get("set-cookie") ?? "", /SameSite=lax/i);
  });
});

test("an unconfigured provider returns to the localized form with a safe error", async () => {
  await withEnvironment({
    NEXT_PUBLIC_APP_URL: "https://gostone.test",
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
  }, async () => {
    const response = await startOAuth(
      new NextRequest("https://gostone.test/api/auth/oauth/google?locale=de"),
      { params: Promise.resolve({ provider: "google" }) },
    );
    assert.equal(
      response.headers.get("location"),
      "https://gostone.test/de/login?oauthError=provider_unavailable",
    );
  });
});

test("the callback rejects mismatched state before contacting a provider", async () => {
  const transaction: OAuthTransaction = {
    state: "a".repeat(43),
    codeVerifier: "b".repeat(43),
    nonce: null,
    mode: "login",
    locale: "en",
    returnTo: null,
    expiresAt: Date.now() + 60_000,
  };
  await withEnvironment({ NEXT_PUBLIC_APP_URL: "https://gostone.test" }, async () => {
    const response = await oauthCallback(new NextRequest(
      "https://gostone.test/api/auth/oauth/google/callback?state=wrong&code=unused",
      { headers: { Cookie: `${oauthTransactionCookie("google")}=${serializeOAuthTransaction(transaction)}` } },
    ), { params: Promise.resolve({ provider: "google" }) });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://gostone.test/login?oauthError=oauth_failed");
    assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/i);
  });
});

test("social usernames are stable, valid, bounded, and provider-specific", () => {
  const identity: VerifiedOAuthIdentity = {
    provider: "google",
    subject: "provider-account-123",
    email: "Very.Long+Player.Name@example.com",
    emailVerified: true,
    displayName: "Very Long Player Name",
  };
  const username = socialUsername(identity);
  assert.equal(username, socialUsername(identity));
  assert.match(username, /^[a-z0-9_]{3,20}$/);
  assert.ok(username.length <= 20);
  assert.notEqual(username, socialUsername({ ...identity, provider: "apple" }));
  assert.notEqual(username, socialUsername(identity, 1));
});

test("the canonical schema and numbered migration protect social identities", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../../db/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../../db/migrations/026_social_auth_identities.sql", import.meta.url), "utf8"),
  ]);
  for (const source of [schema, migration]) {
    assert.match(source, /CREATE TABLE(?: IF NOT EXISTS)? auth_identities/);
    assert.match(source, /PRIMARY KEY \(provider, provider_subject\)/);
    assert.match(source, /UNIQUE \(user_id, provider\)/);
    assert.match(source, /ALTER TABLE auth_identities ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /REVOKE ALL ON auth_identities FROM PUBLIC/);
  }
});
