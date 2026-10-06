import "dotenv/config";
import { closePool, query, withTransaction } from "../lib/db";

const [command, id, ...flags] = process.argv.slice(2);

try {
  if (command === "list" && !id) {
    const result = await query(
      `SELECT request.id, request.player_key, account.username,
              request.confirmation_email, request.status, request.requested_at,
              request.due_at, request.due_at < NOW() AS overdue
         FROM account_deletion_requests request
         LEFT JOIN users account ON request.player_key = 'user:' || account.id::text
        WHERE request.status <> 'completed'
        ORDER BY request.due_at LIMIT 200`,
    );
    console.log(JSON.stringify(result.rows, null, 2));
  } else if (command === "complete" && id && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
    const required = ["--confirm-data-erased", "--confirm-access-revoked", "--confirm-notified"];
    if (required.some((flag) => !flags.includes(flag)) || flags.some((flag) => !required.includes(flag))) {
      throw new Error(`Completion requires all three operator attestations: ${required.join(" ")}`);
    }
    await withTransaction(async (client) => {
      const result = await client.query<{ player_key: string | null; status: string }>(
        "SELECT player_key, status FROM account_deletion_requests WHERE id = $1 FOR UPDATE", [id],
      );
      const request = result.rows[0];
      if (!request) throw new Error("The request does not exist.");
      if (request.status === "completed") return;
      const [kind, identity] = request.player_key!.split(":");
      const remaining = kind === "user"
        ? await client.query("SELECT id FROM users WHERE id = $1", [identity])
        : await client.query("SELECT guest_id FROM guest_sessions WHERE guest_id = $1", [identity]);
      if (remaining.rows.length) throw new Error("The account or guest session still exists. This command does not delete accounts.");
      await client.query(
        `UPDATE account_deletion_requests
            SET status = 'completed', completed_at = statement_timestamp(),
                player_key = NULL, confirmation_email = NULL
          WHERE id = $1`, [id],
      );
    });
    console.log(`Recorded completion for request ${id}.`);
  } else if (command === "purge-completed" && !id) {
    const result = await query(
      "DELETE FROM account_deletion_requests WHERE completed_at < NOW() - INTERVAL '30 days'",
    );
    console.log(`Purged ${result.rowCount ?? 0} expired completion receipts.`);
  } else {
    throw new Error("Usage: npm run deletion:requests -- list | complete <request-uuid> --confirm-data-erased --confirm-access-revoked --confirm-notified | purge-completed");
  }
} finally {
  await closePool();
}
