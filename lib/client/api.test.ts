import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError, readApi } from "./api";

test("preserves retry metadata from a rate-limited response", async () => {
  const response = Response.json(
    {
      ok: false,
      error: "Please slow down.",
      code: "rate_limited",
      retryAfterSeconds: 9,
    },
    { status: 429, headers: { "Retry-After": "12" } },
  );

  await assert.rejects(readApi(response), (error) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, 429);
    assert.equal(error.code, "rate_limited");
    assert.equal(error.retryAfterSeconds, 12);
    return true;
  });
});

test("returns successful API payloads unchanged", async () => {
  const payload = await readApi<{ value: number }>(
    Response.json({ ok: true, value: 42 }),
  );
  assert.equal(payload.value, 42);
});

for (const [name, response] of [
  ["HTML gateway error", new Response("<html>Bad gateway</html>", { status: 502 })],
  ["empty unauthorized response", new Response(null, { status: 401 })],
  ["null JSON payload", Response.json(null)],
  ["invalid success flag", Response.json({ ok: "true" })],
] as const) test(`preserves API error handling for ${name}`, async () => {
  await assert.rejects(readApi(response), (error) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, response.status);
    assert.equal(error.message, "Request failed.");
    return true;
  });
});

test("rate limiting keeps Retry-After even when the proxy returns HTML", async () => {
  await assert.rejects(readApi(new Response("Too many requests", { status: 429, headers: { "Retry-After": "15" } })), error => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.retryAfterSeconds, 15);
    return true;
  });
});
