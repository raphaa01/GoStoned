import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError } from "./api";
import {
  connectionAfterFailure,
  connectionAfterSuccess,
  connectionAllowsChat,
  connectionAllowsGamePolling,
  connectionAllowsMutations,
  connectionAwaitingRefresh,
  connectionClockObservedAt,
  INITIAL_GAME_CONNECTION,
  isTerminalConnection,
  operationAffectsConnection,
} from "./gameConnection";

test("game connection transitions preserve authority boundaries", () => {
  const live = connectionAfterSuccess(1_000, "active");
  assert.deepEqual(live, { kind: "live", lastSuccessAt: 1_000 });
  assert.equal(connectionAllowsMutations(live), true);
  assert.equal(connectionAllowsChat(live), true);

  const reconnecting = connectionAfterFailure(live, new Error("offline"), 1_500, 5_000);
  assert.deepEqual(reconnecting, {
    kind: "reconnecting",
    reason: "network",
    observedAt: 1_500,
    retryAt: 6_500,
  });
  assert.equal(connectionAllowsMutations(reconnecting), false);
  assert.equal(connectionAllowsChat(reconnecting), false);
  assert.equal(connectionClockObservedAt(reconnecting), 1_500);

  const repeated = connectionAfterFailure(reconnecting, new Error("offline"), 2_000, 5_000);
  assert.equal(connectionClockObservedAt(repeated), 1_500);
  assert.deepEqual(connectionAfterSuccess(2_500, "active"), {
    kind: "live",
    lastSuccessAt: 2_500,
  });
  assert.deepEqual(connectionAfterSuccess(2_500, "finished"), {
    kind: "final",
    lastSuccessAt: 2_500,
  });
});

test("rate limits retain the server retry boundary", () => {
  const state = connectionAfterFailure(
    { kind: "live", lastSuccessAt: 1_000 },
    new ApiRequestError("Slow down", {
      status: 429,
      code: "rate_limited",
      retryAfterSeconds: 12,
    }),
    2_000,
    12_000,
  );
  assert.deepEqual(state, {
    kind: "reconnecting",
    reason: "rate_limited",
    observedAt: 2_000,
    retryAt: 14_000,
  });
});

test("protected 401 is terminal and never becomes a retry loop", () => {
  const expired = connectionAfterFailure(
    { kind: "live", lastSuccessAt: 1_000 },
    new ApiRequestError("Expired", { status: 401, code: "session_expired" }),
    2_000,
    5_000,
  );
  assert.deepEqual(expired, { kind: "session_expired", observedAt: 2_000 });
  assert.equal(isTerminalConnection(expired), true);
  assert.equal(connectionAllowsGamePolling(expired, "active"), false);
  assert.equal(connectionAllowsMutations(expired), false);
  assert.equal(connectionAllowsChat(expired), false);
  assert.deepEqual(
    connectionAfterFailure(
      expired,
      new ApiRequestError("Expired", { status: 401 }),
      3_000,
      5_000,
    ),
    expired,
  );
  assert.deepEqual(
    connectionAfterFailure(
      expired,
      new ApiRequestError("Down", { status: 500 }),
      3_000,
      5_000,
    ),
    expired,
  );
});

test("protected terminal client errors stop polling while server failures retry", () => {
  const forbidden = connectionAfterFailure(
    INITIAL_GAME_CONNECTION,
    new ApiRequestError("Forbidden", { status: 403, code: "not_participant" }),
    1_000,
    5_000,
  );
  assert.deepEqual(forbidden, { kind: "unavailable" });
  assert.equal(connectionAllowsGamePolling(forbidden, null), false);
  assert.equal(
    connectionAfterFailure(forbidden, new Error("late transport error"), 2_000, 5_000),
    forbidden,
  );

  const server = connectionAfterFailure(
    INITIAL_GAME_CONNECTION,
    new ApiRequestError("Unavailable", { status: 503 }),
    1_000,
    5_000,
  );
  assert.deepEqual(server, {
    kind: "reconnecting",
    reason: "server",
    observedAt: null,
    retryAt: 6_000,
  });
  assert.equal(connectionAllowsGamePolling(server, null), true);
});

test("a verified final connection cannot be demoted by a late failure", () => {
  const final = connectionAfterSuccess(1_000, "finished");
  assert.equal(connectionAllowsChat(final), true);
  assert.equal(
    connectionAfterFailure(final, new ApiRequestError("Down", { status: 500 }), 2_000, 5_000),
    final,
  );
  assert.deepEqual(
    connectionAfterFailure(final, new ApiRequestError("Expired", { status: 401 }), 2_000, 5_000),
    { kind: "session_expired", observedAt: null },
  );
});

test("visibility and network recovery wait for a real success", () => {
  const live = { kind: "live", lastSuccessAt: 1_000 } as const;
  const hiddenReturn = connectionAwaitingRefresh(live, "network", 4_000);
  assert.deepEqual(hiddenReturn, {
    kind: "reconnecting",
    reason: "network",
    observedAt: 4_000,
    retryAt: 4_000,
  });
  assert.deepEqual(connectionAwaitingRefresh(hiddenReturn, "offline", 5_000), {
    kind: "reconnecting",
    reason: "offline",
    observedAt: 4_000,
    retryAt: 5_000,
  });
});

test("only ambiguous or infrastructure operation failures change connection state", () => {
  assert.equal(operationAffectsConnection(new ApiRequestError("Illegal", { status: 400 })), false);
  assert.equal(operationAffectsConnection(new ApiRequestError("Conflict", { status: 409 })), false);
  assert.equal(operationAffectsConnection(new ApiRequestError("Expired", { status: 401 })), true);
  assert.equal(operationAffectsConnection(new ApiRequestError("Busy", { status: 429 })), true);
  assert.equal(operationAffectsConnection(new ApiRequestError("Down", { status: 500 })), true);
  assert.equal(operationAffectsConnection(new Error("offline")), true);
});
