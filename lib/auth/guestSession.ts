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
    await client.query("DELETE FROM guest_sessions WHERE expires_at <= NOW()");
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
