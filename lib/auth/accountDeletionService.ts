import { createHash, randomBytes } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import { resignGameInTransaction } from "@/lib/game/gameService";
import { AuthError } from "./accountService";
import { revokeAppleToken } from "./oauth";
import { ACCOUNT_DELETION_DAYS, type AccountDeletionReceipt } from "./accountDeletionContract";

export const DELETION_RECEIPT_COOKIE = "gostone_deletion_receipt";

type ReceiptRow = {
  id: string;
  status: AccountDeletionReceipt["status"];
  requested_at: Date;
  due_at: Date;
  completed_at: Date | null;
};

function receipt(row: ReceiptRow): AccountDeletionReceipt {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requested_at.toISOString(),
    dueAt: row.due_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getAccountDeletionRequest(playerKey: string) {
  const result = await query<ReceiptRow>(
    `SELECT id, status, requested_at, due_at, completed_at
       FROM account_deletion_requests
      WHERE player_key = $1 AND status <> 'completed'`,
    [playerKey],
  );
  return result.rows[0] ? receipt(result.rows[0]) : null;
}

export async function getAccountDeletionReceipt(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await query<ReceiptRow>(
    `SELECT id, status, requested_at, due_at, completed_at
       FROM account_deletion_requests
      WHERE receipt_hash = $1
        AND (completed_at IS NULL OR completed_at > NOW() - INTERVAL '30 days')`,
    [tokenHash(token)],
  );
  return result.rows[0] ? receipt(result.rows[0]) : null;
}

export async function requestAccountDeletion(playerKey: string) {
  const token = randomBytes(32).toString("base64url");
  if (!/^(user|guest):[0-9a-f-]{36}$/.test(playerKey)) throw new Error("Invalid deletion identity.");
  const [kind, id] = playerKey.split(":");
  return withTransaction(async client => {
    // Serialize against account changes and session issuance. Identity always
    // comes from the authenticated session, never from the request body.
    const owner = kind === "user"
      ? await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [id])
      : await client.query("SELECT guest_id FROM guest_sessions WHERE guest_id = $1 FOR UPDATE", [id]);
    if (!owner.rows[0]) throw new AuthError("Your session has expired.", 401, "session_expired");

    const apple = kind === "user" ? await client.query<{ provider_subject: string; encrypted_token: string | null }>(
      `SELECT identity.provider_subject, token.encrypted_token FROM auth_identities identity
       LEFT JOIN apple_revocation_tokens token USING (provider_subject)
       WHERE identity.user_id = $1 AND identity.provider = 'apple'`, [id],
    ) : { rows: [] };
    for (const credential of apple.rows) {
      // Legacy accounts never stored provider tokens. Missing historical tokens
      // must not force reauthentication or prevent local account/data erasure.
      if (credential.encrypted_token) {
        try { await revokeAppleToken(credential.provider_subject, credential.encrypted_token); }
        catch { throw new AuthError("Account deletion could not be completed. Please try again.", 503, "deletion_failed"); }
      }
    }

    // Finish active games through the existing rulebook, so opponents are not
    // stranded and their ratings remain valid. Locks are taken in a stable order.
    const games = await client.query<{ id: string }>(
      `SELECT id FROM games WHERE status = 'active'
         AND (black_player_key = $1 OR white_player_key = $1) ORDER BY id FOR UPDATE`, [playerKey],
    );
    for (const game of games.rows) await resignGameInTransaction(client, game.id, playerKey);
    // Validate newly created rating evidence while the rating state still exists.
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");

    if (kind === "user") {
      await client.query(
        `DELETE FROM mobile_oauth_handoffs handoff USING auth_identities identity
         WHERE identity.user_id = $1 AND identity.provider = handoff.provider
           AND identity.provider_subject = handoff.provider_subject`, [id],
      );
      await client.query(
        `DELETE FROM oauth_registration_intents intent USING auth_identities identity
         WHERE identity.user_id = $1 AND identity.provider = intent.provider
           AND identity.provider_subject = intent.provider_subject`, [id],
      );
      await client.query(
        `DELETE FROM apple_revocation_tokens token USING auth_identities identity
         WHERE identity.user_id = $1 AND identity.provider = 'apple'
           AND identity.provider_subject = token.provider_subject`, [id],
      );
    }
    await client.query("DELETE FROM matchmaking_queue WHERE player_key = $1", [playerKey]);
    await client.query("DELETE FROM game_messages WHERE player_key = $1", [playerKey]);
    await client.query("DELETE FROM player_blocks WHERE blocker_key = $1 OR blocked_key = $1", [playerKey]);
    await client.query("DELETE FROM player_reports WHERE reporter_key = $1 OR reported_key = $1", [playerKey]);
    await client.query("DELETE FROM puzzle_attempts WHERE player_key = $1", [playerKey]);
    await client.query("DELETE FROM player_rating_history WHERE player_key = $1", [playerKey]);
    await client.query("DELETE FROM player_stats WHERE player_key = $1", [playerKey]);
    await client.query("DELETE FROM game_share_links WHERE created_by_player_key = $1", [playerKey]);
    // FK cascades erase identities, ALL account sessions, password reset codes,
    // friendships/messages/invites, preferences, progress, votes and live ratings.
    if (kind === "user") await client.query("DELETE FROM users WHERE id = $1", [id]);
    else await client.query("DELETE FROM guest_sessions WHERE guest_id = $1", [id]);

    const result = await client.query<ReceiptRow>(
      `INSERT INTO account_deletion_requests (player_key, confirmation_email, receipt_hash, due_at)
       VALUES ($1, $2, $3, statement_timestamp() + $4 * INTERVAL '1 day')
       ON CONFLICT (player_key) WHERE status <> 'completed'
       DO UPDATE SET receipt_hash = EXCLUDED.receipt_hash
       RETURNING id, status, requested_at, due_at, completed_at`,
      [playerKey, null, tokenHash(token), ACCOUNT_DELETION_DAYS],
    );
    const completed = await client.query<ReceiptRow>(
      `UPDATE account_deletion_requests SET status = 'completed', completed_at = statement_timestamp(),
         player_key = NULL, confirmation_email = NULL WHERE id = $1
       RETURNING id, status, requested_at, due_at, completed_at`, [result.rows[0].id],
    );
    await client.query(
      `DELETE FROM account_deletion_requests WHERE id IN (
        SELECT id FROM account_deletion_requests WHERE status = 'completed'
          AND completed_at < statement_timestamp() - INTERVAL '30 days' LIMIT 200
      )`,
    );
    return { request: receipt(completed.rows[0]), token };
  });
}
