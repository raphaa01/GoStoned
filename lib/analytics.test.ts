import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { isAnalyticsAdminAuthorized } from "./analytics/adminAuth";
import { proxy } from "../proxy";

const username = "gostone-admin";
const password = "correct horse battery staple";
const passwordSha256 = createHash("sha256").update(password).digest("hex");
const credentials = { username, passwordSha256 };

function basic(user: string, secret: string): string {
  return `Basic ${Buffer.from(`${user}:${secret}`, "utf8").toString("base64")}`;
}

test("analytics admin authentication fails closed and accepts only exact credentials", () => {
  assert.equal(isAnalyticsAdminAuthorized(null, credentials), false);
  assert.equal(isAnalyticsAdminAuthorized(basic(username, password), {
    username: undefined,
    passwordSha256: undefined,
  }), false);
  assert.equal(isAnalyticsAdminAuthorized("Bearer token", credentials), false);
  assert.equal(isAnalyticsAdminAuthorized(basic(username, "wrong"), credentials), false);
  assert.equal(isAnalyticsAdminAuthorized(basic("other", password), credentials), false);
  assert.equal(isAnalyticsAdminAuthorized(basic(username, password), credentials), true);
});

test("the unlinked analytics route is challenged, private, and never locale-redirected", () => {
  const previousUser = process.env.WEB_ANALYTICS_ADMIN_USER;
  const previousHash = process.env.WEB_ANALYTICS_ADMIN_PASSWORD_SHA256;
  process.env.WEB_ANALYTICS_ADMIN_USER = username;
  process.env.WEB_ANALYTICS_ADMIN_PASSWORD_SHA256 = passwordSha256;

  try {
    const challenged = proxy(new NextRequest("https://gostone.test/webanalytics", {
      headers: { "Accept-Language": "de-DE" },
    }));
    assert.equal(challenged.status, 401);
    assert.match(challenged.headers.get("www-authenticate") ?? "", /^Basic /);
    assert.match(challenged.headers.get("cache-control") ?? "", /no-store/);
    assert.match(challenged.headers.get("x-robots-tag") ?? "", /noindex/);

    const accepted = proxy(new NextRequest("https://gostone.test/webanalytics", {
      headers: {
        Authorization: basic(username, password),
        "Accept-Language": "de-DE",
      },
    }));
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get("location"), null);
    assert.equal(accepted.headers.get("x-middleware-next"), "1");
    assert.match(accepted.headers.get("x-robots-tag") ?? "", /noindex/);
  } finally {
    if (previousUser === undefined) delete process.env.WEB_ANALYTICS_ADMIN_USER;
    else process.env.WEB_ANALYTICS_ADMIN_USER = previousUser;
    if (previousHash === undefined) delete process.env.WEB_ANALYTICS_ADMIN_PASSWORD_SHA256;
    else process.env.WEB_ANALYTICS_ADMIN_PASSWORD_SHA256 = previousHash;
  }
});
