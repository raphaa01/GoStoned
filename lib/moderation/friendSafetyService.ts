import { withTransaction } from "@/lib/db";
import { GameServiceError } from "@/lib/game/gameServiceError";
import { lockPlayerPair } from "./playerBlockService";
import { isPlayerReportCategory } from "./playerReportContract";
export async function friendSafety(actorId: string, friendshipId: string, action: { category: unknown } | { blocked: boolean } | { read: true }) {
  return withTransaction(async client => {
    const result = await client.query<{ requester_id: string; addressee_id: string }>(`SELECT requester_id, addressee_id FROM friendships
      WHERE id = $1 AND status = 'accepted' AND $2 IN (requester_id, addressee_id)`, [friendshipId, actorId]);
    const friend = result.rows[0];
    if (!friend) throw new GameServiceError("Not found.", 404, "friendship_not_found");
    const actor = `user:${actorId}`; const target = `user:${friend.requester_id === actorId ? friend.addressee_id : friend.requester_id}`;
    await lockPlayerPair(client, actor, target);
    const locked = await client.query("SELECT id FROM friendships WHERE id = $1 AND status = 'accepted' FOR UPDATE", [friendshipId]);
    if (!locked.rowCount) throw new GameServiceError("Not found.", 404, "friendship_not_found");
    if ("read" in action) {
      const own = await client.query<{ blocked: boolean }>("SELECT EXISTS (SELECT 1 FROM player_blocks WHERE blocker_key = $1 AND blocked_key = $2) AS blocked", [actor, target]);
      return { actor, blocked: own.rows[0]?.blocked === true };
    }
    if ("category" in action) {
      if (!isPlayerReportCategory(action.category)) throw new GameServiceError("Invalid category.", 400, "invalid_report_category");
      await client.query(`INSERT INTO moderation_cases (context_kind, context_id, reporter_key, reported_key, category_code, evidence_cursor)
        VALUES ('friend', $1, $2, $3, $4, COALESCE((SELECT MAX(id) FROM friend_messages WHERE friendship_id = $1), 0)) ON CONFLICT DO NOTHING`, [friendshipId, actor, target, action.category]);
      return { actor, reported: true };
    }
    if (action.blocked) await client.query("INSERT INTO player_blocks (blocker_key, blocked_key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [actor, target]);
    else await client.query("DELETE FROM player_blocks WHERE blocker_key = $1 AND blocked_key = $2", [actor, target]);
    return { actor, blocked: action.blocked };
  });
}
