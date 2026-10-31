import { query, withTransaction } from "@/lib/db";
import { GameServiceError } from "@/lib/game/gameServiceError";
import { isModerationAction, type ModerationAction } from "./communityContract";

export async function isModerator(userId: string): Promise<boolean> {
  const result = await query<{ allowed: boolean }>("SELECT EXISTS (SELECT 1 FROM moderation_moderators WHERE user_id = $1) AS allowed", [userId]);
  return result.rows[0]?.allowed === true;
}
export type ModerationCase = { id: string; category: string; createdAt: string; reportedName: string; decision: ModerationAction | null; messages: Array<{ id: string; playerKey: string; message: string }> };
export async function moderationQueue(moderatorId: string, closed = false): Promise<ModerationCase[]> {
  if (!await isModerator(moderatorId)) throw new GameServiceError("Not found.", 404, "not_found");
  await query(`DELETE FROM game_messages WHERE id IN (SELECT id FROM game_messages WHERE moderated_at < statement_timestamp() - INTERVAL '90 days' ORDER BY id LIMIT 1000)`);
  await query(`DELETE FROM friend_messages WHERE id IN (SELECT id FROM friend_messages WHERE moderated_at < statement_timestamp() - INTERVAL '90 days' ORDER BY id LIMIT 1000)`);
  await query(`DELETE FROM moderation_cases WHERE id IN (SELECT case_id FROM moderation_decisions WHERE decided_at < statement_timestamp() - INTERVAL '180 days' ORDER BY decided_at LIMIT 1000)`);
  const result = await query<ModerationCase>(`
    SELECT r.id, (SELECT action FROM moderation_decisions d WHERE d.case_id = r.id) AS decision, r.category_code AS category, r.created_at::text AS "createdAt",
      COALESCE(u.display_name, u.username, 'Guest') AS "reportedName",
      CASE WHEN r.context_kind = 'game' THEN
        COALESCE((SELECT jsonb_agg(m ORDER BY m.id) FROM (
          SELECT id::text, player_key AS "playerKey", message FROM game_messages WHERE game_id = r.context_id ORDER BY id DESC LIMIT 100
        ) m), '[]'::jsonb)
      ELSE COALESCE((SELECT jsonb_agg(m ORDER BY m.id) FROM (
          SELECT id::text, 'user:' || sender_id::text AS "playerKey", message FROM friend_messages WHERE friendship_id = r.context_id ORDER BY id DESC LIMIT 100
        ) m), '[]'::jsonb) END AS messages
    FROM moderation_cases r LEFT JOIN users u ON r.reported_key = 'user:' || u.id::text
    WHERE EXISTS (SELECT 1 FROM moderation_decisions d WHERE d.case_id = r.id) = $1
    ORDER BY (r.category_code = 'threat_or_sexual_safety') DESC, r.created_at, r.id LIMIT 50`, [closed]);
  return result.rows;
}
export async function decideReport(moderatorId: string, caseId: string, action: ModerationAction) {
  if (!isModerationAction(action)) throw new GameServiceError("Invalid decision.", 400, "invalid_request");
  return withTransaction(async client => {
    const member = await client.query("SELECT user_id FROM moderation_moderators WHERE user_id = $1", [moderatorId]);
    if (!member.rowCount) throw new GameServiceError("Not found.", 404, "not_found");
    const found = await client.query<{ context_kind: string; context_id: string; reported_key: string }>("SELECT context_kind, context_id, reported_key FROM moderation_cases WHERE id = $1", [caseId]);
    const report = found.rows[0];
    if (!report) throw new GameServiceError("Not found.", 404, "not_found");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`moderation-player:${report.reported_key}`]);
    // Parent before case matches account erasure and message-send lock order.
    if (report.context_kind === "game") await client.query("SELECT id FROM games WHERE id = $1 FOR UPDATE", [report.context_id]);
    else await client.query("SELECT id FROM friendships WHERE id = $1 FOR UPDATE", [report.context_id]);
    const locked = await client.query("SELECT id FROM moderation_cases WHERE id = $1 FOR UPDATE", [caseId]);
    if (!locked.rowCount) throw new GameServiceError("Not found.", 404, "not_found");
    if (action === "restore") {
      const changed = await client.query("UPDATE moderation_decisions SET action = 'restore', moderator_id = $2, decided_at = statement_timestamp() WHERE case_id = $1 AND action <> 'restore' RETURNING case_id", [caseId, moderatorId]);
      if (!changed.rowCount) return;
      await client.query("DELETE FROM player_restrictions WHERE player_key = $1", [report.reported_key]);
      await client.query(`INSERT INTO player_restrictions (player_key, restricted_until, source_case_id)
        SELECT r.reported_key, d.decided_at + INTERVAL '7 days', r.id FROM moderation_cases r
        JOIN moderation_decisions d ON d.case_id = r.id
        WHERE r.reported_key = $1 AND d.action = 'suspend_7d' AND d.decided_at + INTERVAL '7 days' > statement_timestamp()
        ORDER BY d.decided_at DESC LIMIT 1`, [report.reported_key]);
      const other = await client.query(`SELECT 1 FROM moderation_cases r JOIN moderation_decisions d ON d.case_id = r.id
        WHERE r.context_kind = $1 AND r.context_id = $2 AND d.action IN ('remove_chat', 'suspend_7d') LIMIT 1`, [report.context_kind, report.context_id]);
      if (!other.rowCount) {
        if (report.context_kind === "game") await client.query("UPDATE game_messages SET moderated_at = NULL WHERE game_id = $1", [report.context_id]);
        else await client.query("UPDATE friend_messages SET moderated_at = NULL WHERE friendship_id = $1", [report.context_id]);
      }
      await client.query("INSERT INTO moderation_audit (case_id, moderator_id, action) VALUES ($1, $2, $3)", [caseId, moderatorId, action]);
      return;
    }
    const inserted = await client.query(`INSERT INTO moderation_decisions (case_id, moderator_id, action)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING action`, [caseId, moderatorId, action]);
    if (!inserted.rowCount) return;
    await client.query("INSERT INTO moderation_audit (case_id, moderator_id, action) VALUES ($1, $2, $3)", [caseId, moderatorId, action]);
    if (action !== "dismiss") {
      if (report.context_kind === "game") await client.query("UPDATE game_messages SET moderated_at = statement_timestamp() WHERE game_id = $1 AND moderated_at IS NULL", [report.context_id]);
      else await client.query("UPDATE friend_messages SET moderated_at = statement_timestamp() WHERE friendship_id = $1 AND moderated_at IS NULL", [report.context_id]);
    }
    if (action === "suspend_7d") {
      await client.query(`INSERT INTO player_restrictions (player_key, restricted_until, source_case_id) VALUES ($1, statement_timestamp() + INTERVAL '7 days', $2)
        ON CONFLICT (player_key) DO UPDATE SET restricted_until = GREATEST(player_restrictions.restricted_until, EXCLUDED.restricted_until), source_case_id = EXCLUDED.source_case_id`, [report.reported_key, caseId]);
      await client.query("DELETE FROM matchmaking_queue WHERE player_key = $1", [report.reported_key]);
    }
  });
}
