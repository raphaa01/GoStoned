import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError } from "./api";
import {
  INITIAL_MATCHMAKING_CONNECTION,
  isTerminalMatchmakingConnection,
  matchmakingConnectionAfterFailure,
  matchmakingConnectionAfterSuccess,
  matchmakingConnectionAllowsActions,
  matchmakingConnectionAllowsSync,
  matchmakingOperationNeedsReconciliation,
} from "./matchmakingConnection";

test("matchmaking is not actionable until the queue is server verified", () => {
  assert.equal(matchmakingConnectionAllowsActions(INITIAL_MATCHMAKING_CONNECTION), false);
  const live = matchmakingConnectionAfterSuccess(1_000);
  assert.deepEqual(live, { kind: "live", lastSuccessAt: 1_000 });
  assert.equal(matchmakingConnectionAllowsActions(live), true);
});

test("expired and changed identities stop protected matchmaking distinctly", () => {
  for (const [error, expectedKind] of [
    [new ApiRequestError("Expired", { status: 401, code: "session_expired" }), "session_expired"],
    [new ApiRequestError("Changed", { status: 409, code: "identity_changed" }), "identity_changed"],
  ] as const) {
    const next = matchmakingConnectionAfterFailure(
      matchmakingConnectionAfterSuccess(1),
      error,
      2,
      0,
    );
    assert.deepEqual(next, { kind: expectedKind });
    assert.equal(isTerminalMatchmakingConnection(next), true);
    assert.equal(matchmakingConnectionAllowsSync(next), false);
    assert.equal(matchmakingConnectionAllowsActions(next), false);
  }
});

test("forbidden resources are terminal while transient failures reconcile", () => {
  const live = matchmakingConnectionAfterSuccess(1);
  assert.deepEqual(
    matchmakingConnectionAfterFailure(
      live,
      new ApiRequestError("Forbidden", { status: 403 }),
      2,
      0,
    ),
    { kind: "unavailable" },
  );
  const limited = matchmakingConnectionAfterFailure(
    live,
    new ApiRequestError("Wait", { status: 429, retryAfterSeconds: 7 }),
    2_000,
    7_000,
  );
  assert.deepEqual(limited, {
    kind: "reconnecting",
    reason: "rate_limited",
    retryAt: 9_000,
  });
  assert.equal(matchmakingConnectionAllowsSync(limited), true);
  assert.equal(matchmakingConnectionAllowsActions(limited), false);
});

test("only ambiguous or authority failures require reconciliation", () => {
  assert.equal(matchmakingOperationNeedsReconciliation(new Error("response lost")), true);
  assert.equal(
    matchmakingOperationNeedsReconciliation(new ApiRequestError("Slow down", { status: 429 })),
    true,
  );
  assert.equal(
    matchmakingOperationNeedsReconciliation(new ApiRequestError("Invalid", { status: 400 })),
    false,
  );
  const abort = new Error("cancelled");
  abort.name = "AbortError";
  assert.equal(matchmakingOperationNeedsReconciliation(abort), false);
});
