import { randomInt } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import { AuthError } from "./accountService";
import { requireEmail } from "./email";
import { hashPassword, verifyPassword, validatePasswordIssue } from "./password";

export type ResetCodeSender = (email: string, code: string) => Promise<void>;

export async function requestPasswordReset(emailValue: unknown, send: ResetCodeSender): Promise<void> {
  const email = requireEmail(emailValue);
  const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
  // Slow, salted hashes protect low-entropy codes even if the database leaks.
  const codeHash = await hashPassword(code);
  const pending = await withTransaction(async (client) => {
    const account = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE lower(email) = $1 AND password_hash IS NOT NULL FOR UPDATE", [email],
    );
    const userId = account.rows[0]?.id;
    if (!userId) return null; // OAuth-only accounts are recovered by the provider.
    const inserted = await client.query(
      `INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
       VALUES ($1, $2, statement_timestamp() + INTERVAL '10 minutes')
       ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash,
         attempts = 0, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at, delivered = false
       WHERE password_reset_codes.created_at < statement_timestamp() - INTERVAL '1 minute'
       RETURNING user_id`, [userId, codeHash],
    );
    await client.query(
      `DELETE FROM password_reset_codes WHERE user_id IN (
        SELECT user_id FROM password_reset_codes WHERE expires_at <= statement_timestamp()
        ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED)`,
    );
    return inserted.rows.length ? userId : null;
  });
  if (!pending) return;
  try {
    await send(email, code);
    await query("UPDATE password_reset_codes SET delivered = true WHERE user_id = $1 AND code_hash = $2", [pending, codeHash]);
  } catch {
    await query("DELETE FROM password_reset_codes WHERE user_id = $1 AND code_hash = $2", [pending, codeHash]);
    // The public response stays identical for every valid address.
    console.error("Password reset email delivery failed.");
  }
}

export async function resetAccountPassword(emailValue: unknown, codeValue: unknown, passwordValue: unknown): Promise<void> {
  const email = requireEmail(emailValue);
  if (typeof codeValue !== "string" || !/^\d{8}$/.test(codeValue)) {
    throw new AuthError("The reset code is incorrect or expired.", 400, "invalid_reset_code");
  }
  const passwordIssue = validatePasswordIssue(passwordValue);
  if (passwordIssue) throw new AuthError(passwordIssue.message, 400, passwordIssue.code);
  const passwordHash = await hashPassword(passwordValue as string);
  const reset = await withTransaction(async (client) => {
    // All issuance and redemption paths lock user first, then code.
    const account = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE lower(email) = $1 AND password_hash IS NOT NULL FOR UPDATE", [email],
    );
    const userId = account.rows[0]?.id;
    if (!userId) return false;
    const result = await client.query<{ code_hash: string }>(
      `SELECT code_hash FROM password_reset_codes WHERE user_id = $1 AND delivered
        AND expires_at > statement_timestamp() AND attempts < 5 FOR UPDATE`, [userId],
    );
    const pending = result.rows[0];
    if (!pending) return false;
    if (!await verifyPassword(codeValue, pending.code_hash)) {
      // Return instead of throwing: failed attempts must COMMIT.
      await client.query("UPDATE password_reset_codes SET attempts = attempts + 1 WHERE user_id = $1", [userId]);
      return false;
    }
    await client.query("UPDATE users SET password_hash = $2, updated_at = statement_timestamp() WHERE id = $1", [userId, passwordHash]);
    await client.query("DELETE FROM password_reset_codes WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
    return true;
  });
  if (!reset) throw new AuthError("The reset code is incorrect or expired.", 400, "invalid_reset_code");
}
