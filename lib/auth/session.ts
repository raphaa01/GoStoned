import { createHash, randomBytes } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import type { AuthUser, AuthUserRow } from "./types";
import { serializeAuthUser } from "./types";

export const SESSION_COOKIE = "gostoned_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type SessionRow = AuthUserRow & {
  expires_at: Date;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);

  await withTransaction(async (client) => {
    await client.query("DELETE FROM user_sessions WHERE expires_at <= NOW()");
    await client.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [userId, tokenHash],
    );
  });

  return token;
}

export async function getSessionUser(token: string | undefined): Promise<AuthUser | null> {
  if (!token || token.length > 128) return null;
  const result = await query<SessionRow>(
    `UPDATE user_sessions s
        SET last_seen_at = NOW()
       FROM users u
      WHERE s.token_hash = $1
        AND s.user_id = u.id
        AND s.expires_at > NOW()
      RETURNING u.id, u.username, u.display_name, s.expires_at`,
    [hashToken(token)],
  );
  return result.rows[0] ? serializeAuthUser(result.rows[0]) : null;
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token || token.length > 128) return;
  await query("DELETE FROM user_sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function deleteAllUserSessions(userId: string): Promise<void> {
  await query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
}
