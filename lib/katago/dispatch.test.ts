import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { dispatchKataGoJob, isKataGoOnDemandConfigured } from "./dispatch";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  url: process.env.KATAGO_DISPATCH_URL,
  tokenId: process.env.MODAL_PROXY_TOKEN_ID,
  tokenSecret: process.env.MODAL_PROXY_TOKEN_SECRET,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({
    KATAGO_DISPATCH_URL: originalEnvironment.url,
    MODAL_PROXY_TOKEN_ID: originalEnvironment.tokenId,
    MODAL_PROXY_TOKEN_SECRET: originalEnvironment.tokenSecret,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("on-demand KataGo remains disabled unless all server-only credentials exist", () => {
  process.env.KATAGO_DISPATCH_URL = "https://example.invalid/dispatch";
  delete process.env.MODAL_PROXY_TOKEN_ID;
  delete process.env.MODAL_PROXY_TOKEN_SECRET;
  assert.equal(isKataGoOnDemandConfigured(), false);
});

test("dispatch authenticates one bounded durable job without exposing credentials", async () => {
  process.env.KATAGO_DISPATCH_URL = "https://example.invalid/dispatch";
  process.env.MODAL_PROXY_TOKEN_ID = "wk-test";
  process.env.MODAL_PROXY_TOKEN_SECRET = "ws-test";
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ ok: true }), { status: 202 });
  };

  assert.equal(await dispatchKataGoJob("analysis", "00000000-0000-4000-8000-000000000001"), true);
  assert.equal(request?.url, process.env.KATAGO_DISPATCH_URL);
  assert.equal(new Headers(request?.init?.headers).get("Modal-Key"), "wk-test");
  assert.equal(new Headers(request?.init?.headers).get("Modal-Secret"), "ws-test");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    kind: "analysis",
    targetId: "00000000-0000-4000-8000-000000000001",
  });
});
