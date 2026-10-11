import { withTransaction } from "@/lib/db";
import { AuthError, registrationDatabaseError } from "./accountService";
import { requireEmail } from "./email";
import { serializeAuthUser, type AuthUserRow } from "./types";

export async function completeAccountEmail(userId: string, emailValue: unknown) {
  const email = requireEmail(emailValue);
  return withTransaction(async (client) => {
    // Lock the account so concurrent submissions cannot replace a saved address.
    const account = await client.query<{ email: string | null; password_hash: string | null }>(
      "SELECT email, password_hash FROM users WHERE id = $1 FOR UPDATE", [userId],
    );
    const social = await client.query("SELECT 1 FROM auth_identities WHERE user_id = $1 LIMIT 1", [userId]);
    if (!account.rows[0] || account.rows[0].email || !account.rows[0].password_hash || social.rows.length) {
      throw new AuthError("This account does not need an email address.", 409, "email_not_required");
    }
    const result = await client.query<AuthUserRow>(
      `UPDATE users SET email = $2, updated_at = statement_timestamp()
        WHERE id = $1 RETURNING id, username, display_name, avatar_style,
          coach_beta_enabled, analysis_unlimited`, [userId, email],
    ).catch((error: unknown) => {
      throw registrationDatabaseError(error) ?? error;
    });
    return serializeAuthUser(result.rows[0]);
  });
}
