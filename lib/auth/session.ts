import { createHash, randomBytes } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import type { PoolClient } from "pg";
import type { AuthUser, AuthUserRow } from "./types";
import { serializeAuthUser } from "./types";
import { AuthError } from "./accountService";
import { verifyPassword } from "./password";

export const SESSION_COOKIE = "gostoned_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type SessionRow = AuthUserRow & {
  expires_at: Date;
};

type SessionDeleteExecutor = (tokenHash: string) => Promise<void>;
type SessionLookupExecutor = (tokenHash: string) => Promise<SessionRow | null>;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isSessionTokenFormat(token: string | undefined): token is string {
  return Boolean(token && /^[A-Za-z0-9_-]{43}$/.test(token));
}

const executeSessionDelete: SessionDeleteExecutor = async (tokenHash) => {
  await query("DELETE FROM user_sessions WHERE token_hash = $1", [tokenHash]);
};

const executeSessionLookup: SessionLookupExecutor = async (tokenHash) => {
  const result = await query<SessionRow>(
    `SELECT u.id, u.username, u.display_name, u.avatar_style, s.expires_at,
            (u.password_hash IS NOT NULL AND u.email IS NULL AND NOT EXISTS
              (SELECT 1 FROM auth_identities WHERE user_id = u.id)) AS email_required,
            COALESCE((to_jsonb(u)->>'coach_beta_enabled')::boolean, false) AS coach_beta_enabled,
            COALESCE((to_jsonb(u)->>'analysis_unlimited')::boolean, false) AS analysis_unlimited,
            EXISTS (SELECT 1 FROM moderation_moderators WHERE user_id = u.id) AS moderator
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
};

export async function createSessionInTransaction(
  client: PoolClient,
  userId: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);

  await client.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [userId, tokenHash],
  );
  await client.query(
    `WITH expired_sessions AS MATERIALIZED (
       SELECT user_session.id
         FROM user_sessions AS user_session
        WHERE user_session.expires_at <= NOW()
        ORDER BY user_session.expires_at, user_session.id
        LIMIT 200
        FOR UPDATE OF user_session SKIP LOCKED
     )
     DELETE FROM user_sessions AS user_session
     USING expired_sessions AS expired
     WHERE user_session.id = expired.id`,
  );

  return token;
}

export function createSession(userId: string, password?: string): Promise<string> {
  return withTransaction(async (client) => {
    if (password !== undefined) {
      // Serialize issuance with password recovery. A login verified before a
      // reset must not create a surviving session using the old password.
      const result = await client.query<{ password_hash: string | null }>(
        "SELECT password_hash FROM users WHERE id = $1 FOR UPDATE", [userId],
      );
      const hash = result.rows[0]?.password_hash;
      if (!hash || !await verifyPassword(password, hash)) {
        throw new AuthError("Username or password is incorrect.", 401, "invalid_credentials");
      }
    }
    return createSessionInTransaction(client, userId);
  });
}

export async function getSessionUser(
  token: string | undefined,
  execute: SessionLookupExecutor = executeSessionLookup,
): Promise<AuthUser | null> {
  if (!isSessionTokenFormat(token)) return null;
  const row = await execute(hashToken(token));
  return row ? serializeAuthUser(row) : null;
}

export async function deleteSession(
  token: string | undefined,
  execute: SessionDeleteExecutor = executeSessionDelete,
): Promise<void> {
  if (!isSessionTokenFormat(token)) return;
  await execute(hashToken(token));
}

export async function deleteAllUserSessions(userId: string): Promise<void> {
  await query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
}
