import { createHash, randomBytes } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import type { AuthUser, AuthUserRow } from "./types";
import { serializeAuthUser } from "./types";

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
    `SELECT u.id, u.username, u.display_name, s.expires_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
};

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
