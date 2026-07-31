import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { apiError } from "@/lib/api/responses";
import {
  consumeEphemeralPolicyRateLimit,
  consumeIpPolicyRateLimit,
  consumePolicyRateLimit,
  consumeRateLimit,
  consumeSubjectPolicyRateLimit,
  createRateLimitKey,
  RATE_LIMIT_POLICIES,
  RateLimitError,
  reserveLoginAccountAttempt,
} from "./rateLimit";

type FakeRow = {
  attempts: number;
  window_started_at: Date;
  blocked_until: Date | null;
  retry_after_seconds: number;
};

function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://gostone.test/api/test", { headers });
}

function atomicMemoryExecutor() {
  const rows = new Map<string, FakeRow>();
  return async (_sql: string, values: readonly unknown[]) => {
    await Promise.resolve();
    const key = String(values[0]);
    const limit = Number(values[1]);
    const current = rows.get(key);
    const attempts = current?.blocked_until ? current.attempts : (current?.attempts ?? 0) + 1;
    const blockedUntil =
      current?.blocked_until ?? (attempts > limit ? new Date(Date.now() + 60_000) : null);
    const row = {
      attempts,
      window_started_at: current?.window_started_at ?? new Date(),
      blocked_until: blockedUntil,
      retry_after_seconds: 60,
    };
    rows.set(key, row);
    return { rows: [row] };
  };
}

test("uses one atomic upsert and stores only a hashed key", async () => {
  let statement = "";
  let parameters: readonly unknown[] = [];
  const key = await consumeRateLimit(
    request({ "x-real-ip": "203.0.113.5" }),
    "login",
    "NamedPlayer",
    8,
    15,
    async (sql, values) => {
      statement = sql;
      parameters = values;
      return {
        rows: [{
          attempts: 1,
          window_started_at: new Date(),
          blocked_until: null,
          retry_after_seconds: 900,
        }],
      };
    },
  );

  assert.match(statement, /INSERT INTO auth_rate_limits/);
  assert.match(statement, /ON CONFLICT \(key_hash\) DO UPDATE/);
  assert.doesNotMatch(statement, /SELECT[\s\S]+FOR UPDATE/);
  assert.deepEqual(parameters.slice(1), [8, 15]);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(String(parameters[0]), key);
  assert.doesNotMatch(key, /NamedPlayer|203\.0\.113\.5/);
});

test("concurrent actor requests allow exactly the configured count", async () => {
  const execute = atomicMemoryExecutor();
  const policy = { scope: "concurrent-test", limit: 5, ipLimit: 50, windowMinutes: 1 };
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      consumePolicyRateLimit(
        request({ "x-real-ip": "203.0.113.8" }),
        policy,
        "guest:secure-actor",
        execute,
      ),
    ),
  );

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 5);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 15);
  for (const result of results) {
    if (result.status === "rejected") assert.ok(result.reason instanceof RateLimitError);
  }
});

test("subject budgets atomically bind one normalized username", async () => {
  const execute = atomicMemoryExecutor();
  const policy = {
    scope: "shared-login-test",
    limit: 5,
    windowMinutes: 15,
  };
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_value, index) =>
      consumeSubjectPolicyRateLimit(
        policy,
        index % 2 === 0 ? "NamedPlayer" : "namedplayer",
        execute,
      ),
    ),
  );

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 5);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 15);
  const fulfilledKeys = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  assert.equal(new Set(fulfilledKeys).size, 1);
  assert.match(fulfilledKeys[0], /^[0-9a-f]{64}$/);
  assert.doesNotMatch(fulfilledKeys[0], /NamedPlayer/i);
});

test("login account reservations use sparse recovery after the sustained budget", async () => {
  const username = "NamedPlayer";
  const keys = {
    burst: createRateLimitKey(
      RATE_LIMIT_POLICIES.loginAccountBurst.scope,
      "subject",
      username,
    ),
    sustained: createRateLimitKey(
      RATE_LIMIT_POLICIES.loginAccountSustained.scope,
      "subject",
      username,
    ),
    recovery: createRateLimitKey(
      RATE_LIMIT_POLICIES.loginAccountRecovery.scope,
      "subject",
      username,
    ),
  };
  const observed: string[] = [];
  const reserved = await reserveLoginAccountAttempt(username, async (_sql, values) => {
    const key = String(values[0]);
    observed.push(key);
    const denied = key === keys.sustained;
    return {
      rows: [{
        attempts: denied ? 11 : 1,
        window_started_at: new Date(),
        blocked_until: denied ? new Date(Date.now() + 60_000) : null,
        retry_after_seconds: denied ? 3_600 : 300,
      }],
    };
  });

  assert.deepEqual(observed, [keys.burst, keys.sustained, keys.recovery]);
  assert.deepEqual(reserved, [keys.burst, keys.sustained, keys.recovery]);
});

test("login account reservations deny when the sparse recovery probe is unavailable", async () => {
  const username = "NamedPlayer";
  const burstKey = createRateLimitKey(
    RATE_LIMIT_POLICIES.loginAccountBurst.scope,
    "subject",
    username,
  );
  const attempts: string[] = [];

  await assert.rejects(
    reserveLoginAccountAttempt(username, async (_sql, values) => {
      const key = String(values[0]);
      attempts.push(key);
      const denied = key !== burstKey;
      return {
        rows: [{
          attempts: denied ? 11 : 1,
          window_started_at: new Date(),
          blocked_until: denied ? new Date(Date.now() + 60_000) : null,
          retry_after_seconds: key === burstKey ? 1 : attempts.length === 2 ? 2 : 300,
        }],
      };
    }),
    (error) => error instanceof RateLimitError && error.retryAfterSeconds === 2,
  );
  assert.equal(attempts.length, 3);
});

test("actor and address buckets are independently enforced", async () => {
  const actorExecutor = atomicMemoryExecutor();
  const actorPolicy = { scope: "actor-test", limit: 1, ipLimit: 100, windowMinutes: 1 };
  await consumePolicyRateLimit(
    request({ "x-real-ip": "203.0.113.1" }),
    actorPolicy,
    "user:one",
    actorExecutor,
  );
  await assert.rejects(
    consumePolicyRateLimit(
      request({ "x-real-ip": "203.0.113.2" }),
      actorPolicy,
      "user:one",
      actorExecutor,
    ),
    RateLimitError,
  );

  const addressExecutor = atomicMemoryExecutor();
  const addressPolicy = { scope: "address-test", limit: 100, ipLimit: 1, windowMinutes: 1 };
  await consumePolicyRateLimit(
    request({ "x-real-ip": "203.0.113.3" }),
    addressPolicy,
    "user:one",
    addressExecutor,
  );
  await assert.rejects(
    consumePolicyRateLimit(
      request({ "x-real-ip": "203.0.113.3" }),
      addressPolicy,
      "user:two",
      addressExecutor,
    ),
    RateLimitError,
  );
});

test("ephemeral read guards enforce actor limits without a database executor", () => {
  globalThis.goStoneEphemeralRateLimits = new Map();
  const policy = { scope: "ephemeral-read", limit: 2, ipLimit: 100, windowMinutes: 1 };
  consumeEphemeralPolicyRateLimit(
    request({ "x-real-ip": "203.0.113.30" }),
    policy,
    "user:reader",
  );
  consumeEphemeralPolicyRateLimit(
    request({ "x-real-ip": "203.0.113.31" }),
    policy,
    "user:reader",
  );
  assert.throws(
    () => consumeEphemeralPolicyRateLimit(
      request({ "x-real-ip": "203.0.113.32" }),
      policy,
      "user:reader",
    ),
    RateLimitError,
  );
});

test("player blocking has separate bounded read, burst, and sustained policies", () => {
  assert.deepEqual(RATE_LIMIT_POLICIES.playerBlockRead, {
    scope: "player-block-read",
    limit: 30,
    ipLimit: 300,
    windowMinutes: 1,
  });
  assert.deepEqual(RATE_LIMIT_POLICIES.playerBlockMutationBurst, {
    scope: "player-block-mutation-burst",
    limit: 2,
    ipLimit: 20,
    windowMinutes: 1 / 6,
  });
  assert.deepEqual(RATE_LIMIT_POLICIES.playerBlockMutation, {
    scope: "player-block-mutation",
    limit: 10,
    ipLimit: 100,
    windowMinutes: 1,
  });
});

test("player reporting has separate actor and address burst and hourly policies", () => {
  assert.deepEqual(RATE_LIMIT_POLICIES.playerReportBurst, {
    scope: "player-report-burst",
    limit: 3,
    ipLimit: 30,
    windowMinutes: 1 / 6,
  });
  assert.deepEqual(RATE_LIMIT_POLICIES.playerReportSubmit, {
    scope: "player-report-submit",
    limit: 10,
    ipLimit: 100,
    windowMinutes: 60,
  });
});

test("locale preference has a dedicated database-free address budget", () => {
  assert.deepEqual(RATE_LIMIT_POLICIES.localePreference, {
    scope: "locale-preference",
    limit: 30,
    windowMinutes: 1,
  });
});

test("ephemeral guards keep their process-local store bounded", () => {
  globalThis.goStoneEphemeralRateLimits = new Map();
  for (let index = 0; index < 10_001; index += 1) {
    globalThis.goStoneEphemeralRateLimits.set(`seed-${index}`, {
      attempts: 1,
      windowStartedAt: Date.now(),
      blockedUntil: null,
    });
  }

  consumeEphemeralPolicyRateLimit(
    request({ "x-real-ip": "203.0.113.35" }),
    { scope: "bounded-store", limit: 2, ipLimit: 20, windowMinutes: 1 },
    "user:bounded",
  );
  assert.ok(globalThis.goStoneEphemeralRateLimits.size <= 8_001);
});

test("returns the longest Retry-After when multiple persistent buckets deny", async () => {
  const policy = { scope: "multi-denial", limit: 1, ipLimit: 1, windowMinutes: 1 };
  const actorKey = createRateLimitKey(policy.scope, "actor", "user:blocked");

  await assert.rejects(
    consumePolicyRateLimit(
      request({ "x-real-ip": "203.0.113.40" }),
      policy,
      "user:blocked",
      async (_sql, values) => ({
        rows: [{
          attempts: 2,
          window_started_at: new Date(),
          blocked_until: new Date(Date.now() + 60_000),
          retry_after_seconds: String(values[0]) === actorKey ? 7 : 19,
        }],
      }),
    ),
    (error) => error instanceof RateLimitError && error.retryAfterSeconds === 19,
  );
});

test("uses Vercel's canonical address and ignores spoofable forwarded headers", async () => {
  let observedKey = "";
  const policy = { scope: "address-source", limit: 2, windowMinutes: 1 };
  await consumeIpPolicyRateLimit(
    request({
      "x-vercel-forwarded-for": "203.0.113.10",
      "x-real-ip": "203.0.113.11",
      "x-forwarded-for": "198.51.100.99",
    }),
    policy,
    async (_sql, values) => {
      observedKey = String(values[0]);
      return {
        rows: [{
          attempts: 1,
          window_started_at: new Date(),
          blocked_until: null,
          retry_after_seconds: 60,
        }],
      };
    },
  );
  assert.equal(observedKey, createRateLimitKey(policy.scope, "ip", "203.0.113.10"));

  await consumeIpPolicyRateLimit(
    request({ "x-forwarded-for": "198.51.100.99" }),
    policy,
    async (_sql, values) => {
      observedKey = String(values[0]);
      return {
        rows: [{
          attempts: 1,
          window_started_at: new Date(),
          blocked_until: null,
          retry_after_seconds: 60,
        }],
      };
    },
  );
  assert.equal(observedKey, createRateLimitKey(policy.scope, "ip", "unknown"));
});

test("standardizes rate-limit responses and keeps polling budgets above normal traffic", async () => {
  const response = apiError(new RateLimitError(17));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "17");
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Too many requests. Please try again shortly.",
    code: "rate_limited",
    retryAfterSeconds: 17,
  });

  assert.ok(RATE_LIMIT_POLICIES.gameRead.limit >= Math.ceil(60_000 / 900) * 2);
  assert.ok(RATE_LIMIT_POLICIES.chatRead.limit >= Math.ceil(60_000 / 800) * 2);
  assert.ok(RATE_LIMIT_POLICIES.matchmakingRead.limit >= Math.ceil(60_000 / 1_000) * 2);
  assert.ok(RATE_LIMIT_POLICIES.guestSessionBurst.limit >= 30);
  assert.ok(RATE_LIMIT_POLICIES.publicDatabaseHealth.limit >= 120);
});
