import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as oauthCallback } from "@/app/api/auth/oauth/[provider]/callback/route";
import { GET as startOAuth } from "@/app/api/auth/oauth/[provider]/route";
import {
  configuredOAuthProviders,
  oauthTransactionCookie,
  parseOAuthTransaction,
  serializeOAuthTransaction,
  type OAuthTransaction,
} from "./oauth";

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
      new NextRequest(
        "https://gostone.test/api/auth/oauth/google?mode=register&locale=de&returnTo=%2Fde%2Freview",
      ),
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
    assert.equal(transaction.returnTo, "/review");
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
      new NextRequest(
        "https://gostone.test/api/auth/oauth/google?mode=register&locale=de&returnTo=%2Freview",
      ),
      { params: Promise.resolve({ provider: "google" }) },
    );
    assert.equal(
      response.headers.get("location"),
      "https://gostone.test/de/register?oauthError=provider_unavailable&returnTo=%2Freview",
    );
  });
});

test("only fully configured OAuth providers are presented to users", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const applePrivateKey = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

  await withEnvironment({
    NEXT_PUBLIC_APP_URL: "https://gostone.test",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    APPLE_CLIENT_ID: undefined,
    APPLE_TEAM_ID: undefined,
    APPLE_KEY_ID: undefined,
    APPLE_PRIVATE_KEY: undefined,
  }, async () => {
    assert.deepEqual(configuredOAuthProviders(), ["google"]);
  });

  await withEnvironment({
    NEXT_PUBLIC_APP_URL: "https://gostone.test",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: undefined,
    APPLE_CLIENT_ID: undefined,
    APPLE_TEAM_ID: undefined,
    APPLE_KEY_ID: undefined,
    APPLE_PRIVATE_KEY: undefined,
  }, async () => {
    assert.deepEqual(configuredOAuthProviders(), []);
  });

  await withEnvironment({
    NEXT_PUBLIC_APP_URL: "https://gostone.test",
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    APPLE_CLIENT_ID: "test.gostone.web",
    APPLE_TEAM_ID: "TESTTEAM",
    APPLE_KEY_ID: "TESTKEY",
    APPLE_PRIVATE_KEY: applePrivateKey,
  }, async () => {
    assert.deepEqual(configuredOAuthProviders(), ["apple"]);
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

test("the canonical schema and numbered migration protect social identities", async () => {
  const [schema, tableMigration, policyMigration, registrationMigration, preflight] = await Promise.all([
    readFile(new URL("../../db/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../../db/migrations/027_social_auth_identities.sql", import.meta.url), "utf8"),
    readFile(new URL("../../db/migrations/030_auth_identities_app_policy.sql", import.meta.url), "utf8"),
    readFile(new URL("../../db/migrations/031_oauth_registration_intents.sql", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/check-mvp.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [schema, tableMigration]) {
    assert.match(source, /CREATE TABLE(?: IF NOT EXISTS)? auth_identities/);
    assert.match(source, /PRIMARY KEY \(provider, provider_subject\)/);
    assert.match(source, /UNIQUE \(user_id, provider\)/);
    assert.match(source, /ALTER TABLE auth_identities ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /REVOKE ALL ON auth_identities FROM PUBLIC/);
  }
  for (const source of [schema, policyMigration]) {
    assert.match(source, /policyname = 'gostone_app_server_access'/);
    assert.match(
      source,
      /CREATE POLICY gostone_app_server_access ON auth_identities\s+FOR ALL TO gostone_app USING \(true\) WITH CHECK \(true\)/,
    );
  }
  for (const source of [schema, registrationMigration]) {
    assert.match(source, /CREATE TABLE(?: IF NOT EXISTS)? oauth_registration_intents/);
    assert.match(source, /token_hash TEXT PRIMARY KEY/);
    assert.match(source, /UNIQUE \(provider, provider_subject\)/);
    assert.match(source, /ALTER TABLE oauth_registration_intents ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /REVOKE ALL ON oauth_registration_intents FROM PUBLIC/);
    assert.match(source, /gostone_app_oauth_registration_access/);
    assert.match(source, /username_confirmed BOOLEAN NOT NULL DEFAULT false/);
    assert.match(source, /user_id UUID REFERENCES users\(id\) ON DELETE CASCADE/);
  }
  assert.match(preflight, /"oauth_registration_intents"/);
  assert.match(preflight, /oauth_registration_app_policy_is_valid/);
  assert.match(preflight, /idx_oauth_registration_intents_expires/);
});
