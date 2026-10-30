import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import "dotenv/config";
import { closePool, getPool, query, withTransaction } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { registerAccount } from "../lib/auth/accountService";
import { getAccountDeletionReceipt, requestAccountDeletion } from "../lib/auth/accountDeletionService";
import { createSession, getSessionUser } from "../lib/auth/session";
import { createGuestSession, getGuestSessionIdentity } from "../lib/auth/guestSession";
import { finalizeGameRatings } from "../lib/rating/ratingFinalizer";

async function run() {
  assert.ok(isUnambiguousLocalDatabase(getDatabaseUrl()), "Deletion smoke is isolated-local-only.");
  await assertSmokeDatabaseIdentity(getPool());
  // Production previously recorded 049 without creating its disabled request
  // table. Verify the repair and repeatability without changing the CI schema.
  const repair = await getPool().connect();
  try {
    await repair.query("BEGIN");
    await repair.query("DROP TABLE account_deletion_requests");
    const migration = await readFile(new URL("../db/migrations/056_self_service_account_deletion.sql", import.meta.url), "utf8");
    await repair.query(migration);
    await repair.query(migration);
    assert.equal((await repair.query("SELECT 1 FROM pg_class WHERE oid = 'public.account_deletion_requests'::regclass AND relrowsecurity")).rowCount, 1);
  } finally {
    await repair.query("ROLLBACK");
    repair.release();
  }
  const create = () => registerAccount(`erase_${randomUUID().replaceAll("-", "").slice(0, 12)}`, randomUUID(), null);
  const fresh = await create();
  const extraSession = await createSession(fresh.user.id);
  const result = await requestAccountDeletion(fresh.user.playerKey);
  assert.equal(result.request.status, "completed");
  assert.equal((await getAccountDeletionReceipt(result.token))?.status, "completed");
  assert.equal(await getSessionUser(fresh.token), null);
  assert.equal(await getSessionUser(extraSession), null);

  // Social users must never need to add a local password. Legacy Apple users
  // without retained provider tokens must still be able to delete their data.
  for (const provider of ["google", "apple"]) {
    const account = await create();
    const subject = randomUUID();
    await query("UPDATE users SET password_hash = NULL WHERE id = $1", [account.user.id]);
    await query(`INSERT INTO auth_identities (provider, provider_subject, user_id, username_confirmed)
      VALUES ($1, $2, $3, true)`, [provider, subject, account.user.id]);
    await query(`INSERT INTO oauth_registration_intents (token_hash, provider, provider_subject, expires_at)
      VALUES ($1, $2, $3, now() + INTERVAL '10 minutes')`, [randomBytes(32).toString("hex"), provider, subject]);
    await query(`INSERT INTO mobile_oauth_handoffs (code_hash, code_challenge, provider, provider_subject, expires_at)
      VALUES ($1, $2, $3, $4, now() + INTERVAL '2 minutes')`,
    [randomBytes(32).toString("hex"), randomBytes(32).toString("base64url"), provider, subject]);
    await requestAccountDeletion(account.user.playerKey);
    assert.equal(await getSessionUser(account.token), null);
    for (const table of ["auth_identities", "oauth_registration_intents", "mobile_oauth_handoffs"]) {
      assert.equal((await query(`SELECT 1 FROM ${table} WHERE provider_subject = $1`, [subject])).rowCount, 0);
    }
  }

  const guest = await createGuestSession();
  await query("INSERT INTO player_stats (player_key, board_size) VALUES ($1, 9)", [guest.identity.playerKey]);
  await requestAccountDeletion(guest.identity.playerKey);
  assert.equal(await getGuestSessionIdentity(guest.token), null);
  assert.equal((await query("SELECT 1 FROM player_stats WHERE player_key = $1", [guest.identity.playerKey])).rowCount, 0);

  const departing = await create();
  const opponent = await create();
  const id = departing.user.id;
  const key = departing.user.playerKey;
  const other = opponent.user.playerKey;
  const game = await query<{ id: string }>(`INSERT INTO games (board_size, black_player_key, white_player_key,
    status, result, finish_reason, winner_key, finished_at, to_move)
    VALUES (9, $1, $2, 'finished', 'B+R', 'resignation', $1, now(), NULL) RETURNING id`, [key, other]);
  const gameId = game.rows[0].id;
  await withTransaction(async client => {
    assert.equal((await finalizeGameRatings(client, gameId)).rated, true);
  });
  const active = await query<{ id: string }>(`INSERT INTO games (board_size, black_player_key, white_player_key)
    VALUES (9, $1, $2) RETURNING id`, [key, other]);
  await query("INSERT INTO learn_progress (user_id) VALUES ($1)", [id]);
  await query("INSERT INTO analysis_price_votes (user_id, monthly_price_eur) VALUES ($1, 3)", [id]);
  await query(`INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
    VALUES ($1, 'test-only-hash', now() + INTERVAL '10 minutes')`, [id]);
  const friendship = await query<{ id: string }>(`INSERT INTO friendships (requester_id, addressee_id)
    VALUES ($1, $2) RETURNING id`, [id, opponent.user.id]);
  await query("INSERT INTO friend_messages (friendship_id, sender_id, message) VALUES ($1, $2, 'private')", [friendship.rows[0].id, id]);
  await query("INSERT INTO game_messages (game_id, player_key, message) VALUES ($1, $2, 'private')", [gameId, key]);
  await query("INSERT INTO player_blocks (blocker_key, blocked_key) VALUES ($1, $2)", [key, other]);
  await query("INSERT INTO player_reports (game_id, reporter_key, reported_key, category_code) VALUES ($1, $2, $3, 'other')", [gameId, key, other]);
  await query("INSERT INTO player_stats (player_key, board_size) VALUES ($1, 9) ON CONFLICT DO NOTHING", [key]);
  await query("INSERT INTO puzzle_attempts (puzzle_id, player_key) SELECT id, $1 FROM puzzles LIMIT 1", [key]);
  await requestAccountDeletion(key);

  for (const [table, column, value] of [
    ["users", "id", id], ["auth_identities", "user_id", id], ["user_sessions", "user_id", id],
    ["player_initial_rating_claims", "user_id", id], ["player_rating_preferences", "user_id", id],
    ["player_glicko2_ratings", "player_key", key], ["learn_progress", "user_id", id],
    ["analysis_price_votes", "user_id", id], ["password_reset_codes", "user_id", id],
    ["friendships", "requester_id", id], ["friend_messages", "sender_id", id],
    ["game_messages", "player_key", key], ["player_stats", "player_key", key],
    ["puzzle_attempts", "player_key", key], ["player_rating_history", "player_key", key],
    ["matchmaking_queue", "player_key", key], ["player_blocks", "blocker_key", key],
    ["player_reports", "reporter_key", key], ["account_deletion_requests", "player_key", key],
  ]) assert.equal((await query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [value])).rowCount, 0, `${table} must be erased`);
  assert.equal(await getSessionUser(departing.token), null);
  assert.equal((await getSessionUser(opponent.token))?.id, opponent.user.id);
  const finished = await query<{ result: string; status: string }>("SELECT result, status FROM games WHERE id = $1", [active.rows[0].id]);
  assert.deepEqual(finished.rows[0], { result: "W+R", status: "finished" });
  assert.equal((await query("SELECT 1 FROM game_glicko2_rating_events WHERE game_id = $1", [gameId])).rowCount, 2);
  assert.equal((await query("SELECT 1 FROM game_glicko2_rating_events WHERE game_id = $1", [active.rows[0].id])).rowCount, 2);
  await assert.rejects(query("DELETE FROM game_glicko2_rating_events WHERE game_id = $1", [gameId]), /append-only|immutable/i);
  await assert.rejects(query("DELETE FROM player_initial_rating_claims WHERE user_id = $1", [opponent.user.id]), /append-only/i);
  console.log("Deletion cascades, active/rated games, immutable evidence, sessions, guests and social accounts passed.");
}

run().catch(error => {
  // Fixture SQL contains no credentials, but avoid printing database diagnostics.
  console.error("Account deletion smoke failed:", error instanceof Error ? error.message : "Unknown failure");
  process.exitCode = 1;
}).finally(closePool);
