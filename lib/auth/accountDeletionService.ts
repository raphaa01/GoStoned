import { createHash, randomBytes } from "node:crypto";
import { query } from "@/lib/db";
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

export function accountDeletionEnabled() {
  return process.env.ACCOUNT_DELETION_REQUESTS_ENABLED === "true";
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

export async function requestAccountDeletion(playerKey: string, email: string | null) {
  const token = randomBytes(32).toString("base64url");
  const result = await query<ReceiptRow>(
    `INSERT INTO account_deletion_requests (player_key, confirmation_email, receipt_hash, due_at)
     VALUES ($1, $2, $3, statement_timestamp() + $4 * INTERVAL '1 day')
     ON CONFLICT (player_key) WHERE status <> 'completed'
     DO UPDATE SET receipt_hash = EXCLUDED.receipt_hash
     RETURNING id, status, requested_at, due_at, completed_at`,
    [playerKey, email, tokenHash(token), ACCOUNT_DELETION_DAYS],
  );
  return { request: receipt(result.rows[0]), token };
}
