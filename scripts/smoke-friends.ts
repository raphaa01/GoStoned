import "dotenv/config";
import assert from "node:assert/strict";
import { closePool, query, withTransaction } from "@/lib/db";
import {
  createGameInvite,
  getFriendMessages,
  getFriendsDashboard,
  respondToFriendRequest,
  respondToGameInvite,
  sendFriendMessage,
  sendFriendRequest,
} from "@/lib/friends/friendService";
import { finalizeGameRatings } from "@/lib/rating/ratingFinalizer";

type CreatedUser = { id: string };

async function main() {
  const suffix = Date.now().toString(36).slice(-8);
  const userIds: string[] = [];
  let gameId: string | null = null;
  try {
    const first = await query<CreatedUser>(
      `INSERT INTO users(username,display_name) VALUES ($1,$2) RETURNING id::text`,
      [`friend_${suffix}a`, "Friend Smoke A"],
    );
    const second = await query<CreatedUser>(
      `INSERT INTO users(username,display_name) VALUES ($1,$2) RETURNING id::text`,
      [`friend_${suffix}b`, "Friend Smoke B"],
    );
    const firstId = first.rows[0].id;
    const secondId = second.rows[0].id;
    userIds.push(firstId, secondId);

    const friendshipId = await sendFriendRequest(firstId, secondId);
    const pending = await getFriendsDashboard(secondId);
    assert.equal(pending.requests[0]?.friendshipId, friendshipId);
    assert.equal(pending.requests[0]?.direction, "incoming");

    await respondToFriendRequest(secondId, friendshipId, true);
    const accepted = await getFriendsDashboard(firstId);
    assert.equal(accepted.friends[0]?.friendshipId, friendshipId);

    const sent = await sendFriendMessage(firstId, friendshipId, "Ready for a friendly game?");
    const messages = await getFriendMessages(secondId, friendshipId, 0);
    assert.equal(messages[0]?.id, sent.id);
    assert.equal(messages[0]?.message, "Ready for a friendly game?");

    const invite = await createGameInvite(firstId, friendshipId, 9, "blitz");
    const incoming = await getFriendsDashboard(secondId);
    assert.equal(incoming.invites[0]?.id, invite.id);
    assert.equal(incoming.invites[0]?.direction, "incoming");

    const match = await respondToGameInvite(secondId, invite.id, "accept");
    assert.ok(match.gameId);
    gameId = match.gameId;
    const game = await query<{
      game_type: string;
      board_size: number;
      time_control: string;
      black_player_key: string;
      white_player_key: string;
    }>(
      `SELECT game_type,board_size,time_control,black_player_key,white_player_key
         FROM games WHERE id=$1`,
      [gameId],
    );
    assert.equal(game.rows[0]?.game_type, "friendly");
    assert.equal(game.rows[0]?.board_size, 9);
    assert.equal(game.rows[0]?.time_control, "blitz");
    assert.deepEqual(
      [game.rows[0].black_player_key, game.rows[0].white_player_key].sort(),
      [`user:${firstId}`, `user:${secondId}`].sort(),
    );

    await query(
      `UPDATE games SET status='finished',winner_key=black_player_key,result='B+R',
              finish_reason='resignation',finished_at=statement_timestamp()
        WHERE id=$1`,
      [gameId],
    );
    const rating = await withTransaction((client) => finalizeGameRatings(client, gameId!));
    assert.deepEqual(rating, { rated: false, kind: "unrated" });
    const evidence = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM game_glicko2_rating_events WHERE game_id=$1",
      [gameId],
    );
    assert.equal(evidence.rows[0]?.count, "0");

    process.stdout.write("Friend-system database smoke passed.\n");
  } finally {
    if (gameId) await query("DELETE FROM games WHERE id=$1", [gameId]);
    if (userIds.length) await query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
    await closePool();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
