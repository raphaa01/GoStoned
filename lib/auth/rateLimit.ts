import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { query } from "@/lib/db";

type RateLimitRow = {
  attempts: number;
  window_started_at: Date;
  blocked_until: Date | null;
  retry_after_seconds: number;
};

type RateLimitExecutor = (
  text: string,
  values: readonly unknown[],
) => Promise<{ rows: RateLimitRow[] }>;

type EphemeralRateLimitRow = {
  attempts: number;
  windowStartedAt: number;
  blockedUntil: number | null;
};

declare global {
  var goStoneEphemeralRateLimits: Map<string, EphemeralRateLimitRow> | undefined;
}

export type RateLimitPolicy = {
  scope: string;
  limit: number;
  ipLimit?: number;
  windowMinutes: number;
};

export const RATE_LIMIT_POLICIES = {
  guestSessionBurst: { scope: "guest-session-burst", limit: 30, windowMinutes: 1 },
  guestSessionCreate: { scope: "guest-session", limit: 120, windowMinutes: 60 },
  guestSessionLookup: { scope: "guest-session-lookup", limit: 120, windowMinutes: 1 },
  accountSessionLookup: { scope: "account-session-lookup", limit: 120, windowMinutes: 1 },
  loginTarget: { scope: "login-target", limit: 8, windowMinutes: 15 },
  loginAddress: { scope: "login-address", limit: 120, windowMinutes: 15 },
  registerTarget: { scope: "register-target", limit: 3, windowMinutes: 60 },
  registerAddress: { scope: "register-address", limit: 30, windowMinutes: 60 },
  protectedIdentityLookup: {
    scope: "protected-identity-lookup",
    limit: 3_000,
    windowMinutes: 1,
  },
  matchmakingRead: {
    scope: "matchmaking-read",
    limit: 180,
    ipLimit: 1_500,
    windowMinutes: 1,
  },
  matchmakingJoinBurst: {
    scope: "matchmaking-join-burst",
    limit: 4,
    ipLimit: 40,
    windowMinutes: 1 / 6,
  },
  matchmakingJoin: {
    scope: "matchmaking-join",
    limit: 12,
    ipLimit: 120,
    windowMinutes: 1,
  },
  matchmakingCancel: {
    scope: "matchmaking-cancel",
    limit: 30,
    ipLimit: 300,
    windowMinutes: 1,
  },
  gameRead: { scope: "game-read", limit: 180, ipLimit: 1_800, windowMinutes: 1 },
  chatRead: { scope: "chat-read", limit: 210, ipLimit: 2_100, windowMinutes: 1 },
  moveBurst: {
    scope: "game-move-burst",
    limit: 6,
    ipLimit: 60,
    windowMinutes: 1 / 6,
  },
  move: { scope: "game-move", limit: 30, ipLimit: 300, windowMinutes: 1 },
  chatSendBurst: {
    scope: "chat-send-burst",
    limit: 5,
    ipLimit: 50,
    windowMinutes: 1 / 6,
  },
  chatSend: { scope: "chat-send", limit: 20, ipLimit: 200, windowMinutes: 1 },
  resignBurst: {
    scope: "game-resign-burst",
    limit: 2,
    ipLimit: 20,
    windowMinutes: 1 / 6,
  },
  resign: { scope: "game-resign", limit: 6, ipLimit: 60, windowMinutes: 1 },
  publicGameSummary: { scope: "public-game-summary", limit: 60, windowMinutes: 1 },
  publicStats: { scope: "public-stats", limit: 60, windowMinutes: 1 },
  publicDatabaseHealth: { scope: "public-database-health", limit: 120, windowMinutes: 1 },
  profileRead: { scope: "profile-read", limit: 30, ipLimit: 300, windowMinutes: 1 },
} as const satisfies Record<string, RateLimitPolicy>;

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many requests. Please try again shortly.");
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function ephemeralStore(): Map<string, EphemeralRateLimitRow> {
  if (!globalThis.goStoneEphemeralRateLimits) {
    globalThis.goStoneEphemeralRateLimits = new Map();
  }
  return globalThis.goStoneEphemeralRateLimits;
}

function requestAddress(request: NextRequest): string {
  const candidates = [
    request.headers.get("x-vercel-forwarded-for"),
    request.headers.get("x-real-ip"),
  ];

  for (const candidate of candidates) {
    const address = candidate?.split(",")[0]?.trim().toLowerCase();
    if (address && address.length <= 64 && isIP(address)) return address;
  }
  return "unknown";
}

export function createRateLimitKey(
  scope: string,
  dimension: "actor" | "ip" | "ip-subject",
  subject: string,
): string {
  return createHash("sha256")
    .update(`v2\0${scope}\0${dimension}\0${subject.toLowerCase()}`)
    .digest("hex");
}

const executeRateLimit: RateLimitExecutor = (text, values) =>
  query<RateLimitRow>(text, values);

export async function consumeRateLimit(
  request: NextRequest,
  scope: string,
  subject: string,
  limit: number,
  windowMinutes: number,
  execute: RateLimitExecutor = executeRateLimit,
): Promise<string> {
  const key = createRateLimitKey(
    scope,
    "ip-subject",
    `${requestAddress(request)}\0${subject}`,
  );
  const row = await recordRateLimit(key, limit, windowMinutes, execute);
  throwIfDenied(row, limit);
  return key;
}

async function recordRateLimit(
  key: string,
  limit: number,
  windowMinutes: number,
  execute: RateLimitExecutor,
): Promise<RateLimitRow> {
  if (!Number.isInteger(limit) || limit < 1 || windowMinutes <= 0) {
    throw new RangeError("Rate-limit policies require a positive limit and window.");
  }

  const result = await execute(
    `INSERT INTO auth_rate_limits
       (key_hash, attempts, window_started_at, blocked_until, updated_at)
     VALUES ($1, 1, NOW(), NULL, NOW())
     ON CONFLICT (key_hash) DO UPDATE
     SET attempts = CASE
           WHEN auth_rate_limits.blocked_until > NOW()
             THEN auth_rate_limits.attempts
           WHEN auth_rate_limits.window_started_at <=
                NOW() - ($3::double precision * INTERVAL '1 minute')
             THEN 1
           ELSE auth_rate_limits.attempts + 1
         END,
         window_started_at = CASE
           WHEN auth_rate_limits.blocked_until > NOW()
             THEN auth_rate_limits.window_started_at
           WHEN auth_rate_limits.window_started_at <=
                NOW() - ($3::double precision * INTERVAL '1 minute')
             THEN NOW()
           ELSE auth_rate_limits.window_started_at
         END,
         blocked_until = CASE
           WHEN auth_rate_limits.blocked_until > NOW()
             THEN auth_rate_limits.blocked_until
           WHEN auth_rate_limits.window_started_at <=
                NOW() - ($3::double precision * INTERVAL '1 minute')
             THEN NULL
           WHEN auth_rate_limits.attempts + 1 > $2
             THEN NOW() + ($3::double precision * INTERVAL '1 minute')
           ELSE NULL
         END,
         updated_at = NOW()
     RETURNING attempts, window_started_at, blocked_until,
       GREATEST(
         1,
         CEIL(EXTRACT(EPOCH FROM (
           COALESCE(
             blocked_until,
             window_started_at + ($3::double precision * INTERVAL '1 minute')
           ) - NOW()
         )))
       )::int AS retry_after_seconds`,
    [key, limit, windowMinutes],
  );
  const row = result.rows[0];

  if (!row) throw new Error("Rate limit did not return a result.");
  return row;
}

function throwIfDenied(row: RateLimitRow, limit: number): void {
  if (row.attempts > limit || row.blocked_until) {
    throw new RateLimitError(row.retry_after_seconds);
  }
}

function recordEphemeralRateLimit(
  key: string,
  limit: number,
  windowMinutes: number,
  now = Date.now(),
): { denied: boolean; retryAfterSeconds: number } {
  if (!Number.isInteger(limit) || limit < 1 || windowMinutes <= 0) {
    throw new RangeError("Rate-limit policies require a positive limit and window.");
  }

  const store = ephemeralStore();
  const windowMilliseconds = windowMinutes * 60_000;
  const current = store.get(key);
  const blocked = Boolean(current?.blockedUntil && current.blockedUntil > now);
  const expired = !current || now - current.windowStartedAt >= windowMilliseconds;
  const attempts = blocked ? current!.attempts : expired ? 1 : current.attempts + 1;
  const windowStartedAt = blocked ? current!.windowStartedAt : expired ? now : current.windowStartedAt;
  const blockedUntil = blocked
    ? current!.blockedUntil
    : attempts > limit
      ? now + windowMilliseconds
      : null;

  store.delete(key);
  store.set(key, { attempts, windowStartedAt, blockedUntil });
  if (store.size > 10_000) {
    for (const [storedKey, row] of store) {
      if (now - row.windowStartedAt >= 48 * 60 * 60_000) store.delete(storedKey);
      if (store.size <= 8_000) break;
    }
    for (const storedKey of store.keys()) {
      if (store.size <= 8_000) break;
      store.delete(storedKey);
    }
  }

  const retryAt = blockedUntil ?? windowStartedAt + windowMilliseconds;
  return {
    denied: attempts > limit || Boolean(blockedUntil),
    retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1_000)),
  };
}

export async function consumePolicyRateLimit(
  request: NextRequest,
  policy: RateLimitPolicy,
  subject: string,
  execute: RateLimitExecutor = executeRateLimit,
): Promise<string> {
  const actorKey = createRateLimitKey(policy.scope, "actor", subject);
  const ipKey = createRateLimitKey(policy.scope, "ip", requestAddress(request));
  const buckets = [
    { key: actorKey, limit: policy.limit },
    { key: ipKey, limit: policy.ipLimit ?? policy.limit * 10 },
  ].sort((left, right) => left.key.localeCompare(right.key));
  const decisions: Array<{ row: RateLimitRow; limit: number }> = [];

  for (const bucket of buckets) {
    decisions.push({
      row: await recordRateLimit(
        bucket.key,
        bucket.limit,
        policy.windowMinutes,
        execute,
      ),
      limit: bucket.limit,
    });
  }

  const denied = decisions.filter(
    ({ row, limit }) => row.attempts > limit || Boolean(row.blocked_until),
  );
  if (denied.length > 0) {
    throw new RateLimitError(
      Math.max(...denied.map(({ row }) => row.retry_after_seconds)),
    );
  }
  return actorKey;
}

export async function consumeIpPolicyRateLimit(
  request: NextRequest,
  policy: RateLimitPolicy,
  execute: RateLimitExecutor = executeRateLimit,
): Promise<string> {
  const key = createRateLimitKey(policy.scope, "ip", requestAddress(request));
  const limit = policy.ipLimit ?? policy.limit;
  const row = await recordRateLimit(key, limit, policy.windowMinutes, execute);
  throwIfDenied(row, limit);
  return key;
}

export function consumeEphemeralPolicyRateLimit(
  request: NextRequest,
  policy: RateLimitPolicy,
  subject: string,
): string {
  const actorKey = createRateLimitKey(policy.scope, "actor", subject);
  const ipKey = createRateLimitKey(policy.scope, "ip", requestAddress(request));
  const decisions = [
    recordEphemeralRateLimit(actorKey, policy.limit, policy.windowMinutes),
    recordEphemeralRateLimit(
      ipKey,
      policy.ipLimit ?? policy.limit * 10,
      policy.windowMinutes,
    ),
  ];
  const denied = decisions.filter((decision) => decision.denied);
  if (denied.length > 0) {
    throw new RateLimitError(
      Math.max(...denied.map(({ retryAfterSeconds }) => retryAfterSeconds)),
    );
  }
  return actorKey;
}

export function consumeEphemeralIpPolicyRateLimit(
  request: NextRequest,
  policy: RateLimitPolicy,
): string {
  const key = createRateLimitKey(policy.scope, "ip", requestAddress(request));
  const decision = recordEphemeralRateLimit(
    key,
    policy.ipLimit ?? policy.limit,
    policy.windowMinutes,
  );
  if (decision.denied) throw new RateLimitError(decision.retryAfterSeconds);
  return key;
}

export async function clearRateLimit(key: string): Promise<void> {
  await query("DELETE FROM auth_rate_limits WHERE key_hash = $1", [key]);
}
