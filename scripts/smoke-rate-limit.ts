import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { clearRateLimit, consumeRateLimit, RateLimitError } from "../lib/auth/rateLimit";
import { closePool, getPool, query } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";

type StoredLimit = {
  attempts: number;
  blocked_until: Date | null;
};

async function run() {
  const databaseUrl = getDatabaseUrl();
  if (!isUnambiguousLocalDatabase(databaseUrl)) {
    throw new Error("Rate-limit smoke tests may only mutate a local PostgreSQL database.");
  }
  await assertSmokeDatabaseIdentity(getPool());

  const request = new NextRequest("http://localhost/api/rate-limit-smoke", {
    headers: { "x-real-ip": "127.0.0.1" },
  });
  const subject = `smoke-${randomUUID()}`;
  const key = await consumeRateLimit(request, "concurrency-smoke", subject, 20, 1);
  await clearRateLimit(key);

  try {
    const attempts = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        consumeRateLimit(request, "concurrency-smoke", subject, 20, 1),
      ),
    );
    assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 20);
    assert.equal(attempts.filter(({ status }) => status === "rejected").length, 80);
    for (const attempt of attempts) {
      if (attempt.status === "rejected") assert.ok(attempt.reason instanceof RateLimitError);
    }

    const blocked = await query<StoredLimit>(
      "SELECT attempts, blocked_until FROM auth_rate_limits WHERE key_hash = $1",
      [key],
    );
    assert.equal(blocked.rows[0].attempts, 21);
    assert.ok(blocked.rows[0].blocked_until);
    const originalBlockEnd = blocked.rows[0].blocked_until!.getTime();

    await assert.rejects(
      consumeRateLimit(request, "concurrency-smoke", subject, 20, 1),
      RateLimitError,
    );
    const stillBlocked = await query<StoredLimit>(
      "SELECT attempts, blocked_until FROM auth_rate_limits WHERE key_hash = $1",
      [key],
    );
    assert.equal(stillBlocked.rows[0].attempts, 21);
    assert.equal(stillBlocked.rows[0].blocked_until?.getTime(), originalBlockEnd);

    await query(
      `UPDATE auth_rate_limits
          SET window_started_at = NOW() - INTERVAL '2 minutes',
              blocked_until = NOW() - INTERVAL '1 minute'
        WHERE key_hash = $1`,
      [key],
    );
    await consumeRateLimit(request, "concurrency-smoke", subject, 20, 1);
    const reset = await query<StoredLimit>(
      "SELECT attempts, blocked_until FROM auth_rate_limits WHERE key_hash = $1",
      [key],
    );
    assert.equal(reset.rows[0].attempts, 1);
    assert.equal(reset.rows[0].blocked_until, null);
    console.log("Atomic rate-limit concurrency smoke passed (20 allowed, 80 denied).");
  } finally {
    await clearRateLimit(key);
  }
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Rate-limit smoke failed.");
    process.exitCode = 1;
  })
  .finally(closePool);
