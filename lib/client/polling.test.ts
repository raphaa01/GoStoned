import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError } from "./api";
import { createPollingRequestGuard, nextPollDelay } from "./polling";

test("polling honors Retry-After and backs off transient failures", () => {
  assert.equal(
    nextPollDelay(
      900,
      new ApiRequestError("Slow down", {
        status: 429,
        code: "rate_limited",
        retryAfterSeconds: 7,
      }),
    ),
    7_000,
  );
  assert.equal(nextPollDelay(900, new Error("offline")), 5_000);
  assert.equal(nextPollDelay(900), 900);
});

test("hidden pages slow polling without overriding a longer server delay", () => {
  assert.equal(nextPollDelay(900, null, true), 10_000);
  assert.equal(
    nextPollDelay(
      900,
      new ApiRequestError("Slow down", { status: 429, retryAfterSeconds: 15 }),
      true,
    ),
    15_000,
  );
});

test("poll request guards invalidate stale and cancelled responses", () => {
  const guard = createPollingRequestGuard();
  const first = guard.start();
  assert.equal(guard.isCurrent(first), true);

  const second = guard.start();
  assert.equal(first.aborted, true);
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);

  guard.cancel();
  assert.equal(second.aborted, true);
  assert.equal(guard.isCurrent(second), false);
});
