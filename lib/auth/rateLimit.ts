import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { query, withTransaction } from "@/lib/db";

type RateLimitRow = {
  attempts: number;
  window_started_at: Date;
  blocked_until: Date | null;
};

export class RateLimitError extends Error {}

function requestAddress(request: NextRequest): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}

function keyHash(request: NextRequest, scope: string, subject: string): string {
  return createHash("sha256")
    .update(`${scope}:${requestAddress(request)}:${subject.toLowerCase()}`)
    .digest("hex");
}

export async function consumeRateLimit(
  request: NextRequest,
  scope: string,
  subject: string,
  limit: number,
  windowMinutes: number,
): Promise<string> {
  const key = keyHash(request, scope, subject);

  await withTransaction(async (client) => {
    const current = await client.query<RateLimitRow>(
      `SELECT attempts, window_started_at, blocked_until
         FROM auth_rate_limits
        WHERE key_hash = $1
        FOR UPDATE`,
      [key],
    );
    const row = current.rows[0];

    if (row?.blocked_until && row.blocked_until.getTime() > Date.now()) {
      throw new RateLimitError("Too many attempts. Please try again later.");
    }

    const expired =
      !row ||
      Date.now() - row.window_started_at.getTime() > windowMinutes * 60_000;
    const attempts = expired ? 1 : row.attempts + 1;
    const blocked = attempts > limit;

    await client.query(
      `INSERT INTO auth_rate_limits
         (key_hash, attempts, window_started_at, blocked_until, updated_at)
       VALUES (
         $1, $2, NOW(),
         CASE WHEN $3 THEN NOW() + ($4 * INTERVAL '1 minute') ELSE NULL END,
         NOW()
       )
       ON CONFLICT (key_hash) DO UPDATE
       SET attempts = $2,
           window_started_at = CASE
             WHEN $5 THEN NOW()
             ELSE auth_rate_limits.window_started_at
           END,
           blocked_until = CASE
             WHEN $3 THEN NOW() + ($4 * INTERVAL '1 minute')
             ELSE NULL
           END,
           updated_at = NOW()`,
      [key, attempts, blocked, windowMinutes, expired],
    );

    if (blocked) throw new RateLimitError("Too many attempts. Please try again later.");
  });

  return key;
}

export async function clearRateLimit(key: string): Promise<void> {
  await query("DELETE FROM auth_rate_limits WHERE key_hash = $1", [key]);
}
