import { createHash, randomBytes } from "node:crypto";
import { query, withTransaction } from "@/lib/db";

export const GUEST_SESSION_COOKIE = "gostone_guest_session";
export const GUEST_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type GuestSessionRow = {
  guest_id: string;
};

export type GuestIdentity = {
  playerKey: string;
  displayName: string;
};

export function hashGuestSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createGuestSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function serializeGuestIdentity(guestId: string): GuestIdentity {
  const playerKey = `guest:${guestId}`;
  return {
    playerKey,
    displayName: `Guest ${guestId.slice(-6).toUpperCase()}`,
  };
}

export function guestSessionCookieOptions(isProduction = process.env.NODE_ENV === "production") {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction,
    path: "/",
    maxAge: GUEST_SESSION_MAX_AGE_SECONDS,
    priority: "high" as const,
  };
}

export async function createGuestSession(): Promise<{
  identity: GuestIdentity;
  token: string;
}> {
  const token = createGuestSessionToken();
  const tokenHash = hashGuestSessionToken(token);

  const guestId = await withTransaction(async (client) => {
    await client.query(
      `WITH expired_guests AS MATERIALIZED (
         SELECT guest_id
           FROM guest_sessions
          WHERE expires_at <= NOW()
          ORDER BY expires_at, guest_id
          LIMIT 200
          FOR UPDATE SKIP LOCKED
       )
       DELETE FROM guest_sessions AS guest_session
       USING expired_guests AS expired
       WHERE guest_session.guest_id = expired.guest_id`,
    );
    await client.query(
      `WITH expired_guest_blocks AS MATERIALIZED (
         SELECT player_block.ctid
           FROM player_blocks AS player_block
          WHERE player_block.created_at < NOW() - INTERVAL '30 days'
            AND (
              player_block.blocker_key LIKE 'guest:%'
              OR player_block.blocked_key LIKE 'guest:%'
            )
          ORDER BY player_block.created_at,
                   player_block.blocker_key,
                   player_block.blocked_key
          LIMIT 200
          FOR UPDATE OF player_block SKIP LOCKED
       )
       DELETE FROM player_blocks AS player_block
       USING expired_guest_blocks AS expired
       WHERE player_block.ctid = expired.ctid`,
    );
    await client.query(
      `WITH stale AS (
         SELECT key_hash
           FROM auth_rate_limits
          WHERE updated_at < NOW() - INTERVAL '48 hours'
          ORDER BY updated_at
          LIMIT 200
          FOR UPDATE SKIP LOCKED
       )
       DELETE FROM auth_rate_limits AS rate_limit
       USING stale
       WHERE rate_limit.key_hash = stale.key_hash`,
    );
    const result = await client.query<GuestSessionRow>(
      `INSERT INTO guest_sessions (token_hash, expires_at)
       VALUES ($1, NOW() + INTERVAL '30 days')
       RETURNING guest_id`,
      [tokenHash],
    );
    return result.rows[0].guest_id;
  });

  return { identity: serializeGuestIdentity(guestId), token };
}

export async function getGuestSessionIdentity(
  token: string | undefined,
): Promise<GuestIdentity | null> {
  if (!token || token.length > 128) return null;
  const result = await query<GuestSessionRow>(
    `SELECT guest_id
       FROM guest_sessions
      WHERE token_hash = $1
        AND expires_at > NOW()`,
    [hashGuestSessionToken(token)],
  );
  return result.rows[0] ? serializeGuestIdentity(result.rows[0].guest_id) : null;
}
