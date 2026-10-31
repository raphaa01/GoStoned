import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import { query, closePool, getPool } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { registerAccount } from "../lib/auth/accountService";
import { acceptCommunityRules } from "../lib/moderation/communityService";
import { getGameMessages, sendGameMessage } from "../lib/game/chatService";
import { reportGameOpponent } from "../lib/moderation/playerReportService";
import { friendSafety } from "../lib/moderation/friendSafetyService";
import { decideReport, isModerator, moderationQueue } from "../lib/moderation/moderationService";
import { sendFriendMessage } from "../lib/friends/friendService";
import { requestAccountDeletion } from "../lib/auth/accountDeletionService";

async function run() {
  assert.ok(isUnambiguousLocalDatabase(getDatabaseUrl()), "Moderation smoke is local-only.");
  await assertSmokeDatabaseIdentity(getPool());
  const name = () => `mod_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const moderator = (await registerAccount(name(), randomUUID(), null)).user;
  const reported = (await registerAccount(name(), randomUUID(), null)).user;
  const stranger = (await registerAccount(name(), randomUUID(), null)).user;
  await query("INSERT INTO moderation_moderators(user_id) VALUES ($1)", [moderator.id]);
  assert.equal(await isModerator(moderator.id), true);
  assert.equal(await isModerator(stranger.id), false);
  await assert.rejects(moderationQueue(stranger.id), { code: "not_found" });
  const game = randomUUID();
  await query(`INSERT INTO games(id, game_type, board_size, black_player_key, white_player_key, time_control)
    VALUES ($1, 'friendly', 9, $2, $3, 'rapid')`, [game, moderator.playerKey, reported.playerKey]);
  await assert.rejects(sendGameMessage(game, reported.playerKey, "Good game"), { code: "community_rules_required" });
  await acceptCommunityRules(reported.playerKey);
  await sendGameMessage(game, reported.playerKey, "Good game");
  await reportGameOpponent(game, moderator.playerKey, "abuse_or_hate");
  await reportGameOpponent(game, moderator.playerKey, "other");
  const first = (await moderationQueue(moderator.id))[0];
  assert.equal(first.category, "abuse_or_hate");
  await assert.rejects(decideReport(stranger.id, first.id, "suspend_7d"), { code: "not_found" });
  await Promise.all([decideReport(moderator.id, first.id, "remove_chat"), decideReport(moderator.id, first.id, "remove_chat")]);
  assert.equal((await getGameMessages(game, moderator.playerKey)).available, false);
  assert.equal((await query("SELECT 1 FROM moderation_audit WHERE case_id=$1", [first.id])).rowCount, 1);
  assert.equal((await moderationQueue(moderator.id, true))[0].decision, "remove_chat");
  await decideReport(moderator.id, first.id, "restore");
  assert.equal((await getGameMessages(game, moderator.playerKey)).available, true);
  const friendship = randomUUID();
  await query("INSERT INTO friendships(id,requester_id,addressee_id,status,responded_at) VALUES ($1,$2,$3,'accepted',statement_timestamp())", [friendship, moderator.id, reported.id]);
  await sendFriendMessage(reported.id, friendship, "Hello");
  await assert.rejects(friendSafety(stranger.id, friendship, { category: "other" }), { code: "friendship_not_found" });
  await friendSafety(moderator.id, friendship, { category: "threat_or_sexual_safety" });
  const second = (await moderationQueue(moderator.id))[0];
  await decideReport(moderator.id, second.id, "suspend_7d");
  await assert.rejects(sendFriendMessage(reported.id, friendship, "Hello again"), { code: "community_suspended" });
  await assert.rejects(sendGameMessage(game, reported.playerKey, "Hello again"), { code: "community_suspended" });
  await decideReport(moderator.id, second.id, "restore");
  await friendSafety(moderator.id, friendship, { blocked: true });
  await assert.rejects(sendFriendMessage(reported.id, friendship, "Hello again"), { code: "chat_unavailable" });
  for (const table of ["moderation_moderators", "moderation_cases", "moderation_decisions", "moderation_audit", "community_acceptances", "player_restrictions"]) {
    const access = await query<{ allowed: boolean }>("SELECT has_table_privilege('anon',$1,'SELECT') AS allowed", [table]);
    assert.equal(access.rows[0].allowed, false);
  }
  const runtime = await query("SELECT 1 FROM pg_roles WHERE rolname='gostone_app'");
  if (process.env.CI === "true") assert.equal(runtime.rowCount, 1);
  if (runtime.rowCount) {
    const grants = await query<{ membership_read: boolean; membership_write: boolean; audit_append: boolean; audit_mutate: boolean }>(`SELECT
      has_table_privilege('gostone_app','moderation_moderators','SELECT') AS membership_read,
      (has_table_privilege('gostone_app','moderation_moderators','INSERT') OR has_table_privilege('gostone_app','moderation_moderators','UPDATE') OR has_table_privilege('gostone_app','moderation_moderators','DELETE')) AS membership_write,
      has_table_privilege('gostone_app','moderation_audit','SELECT,INSERT') AS audit_append,
      (has_table_privilege('gostone_app','moderation_audit','UPDATE') OR has_table_privilege('gostone_app','moderation_audit','DELETE')) AS audit_mutate`);
    assert.deepEqual(grants.rows[0], { membership_read: true, membership_write: false, audit_append: true, audit_mutate: false });
  }
  await query("DELETE FROM moderation_moderators WHERE user_id=$1", [moderator.id]);
  await assert.rejects(moderationQueue(moderator.id), { code: "not_found" });
  await requestAccountDeletion(reported.playerKey);
  assert.equal((await query("SELECT 1 FROM community_acceptances WHERE player_key=$1", [reported.playerKey])).rowCount, 0);
  assert.equal((await query("SELECT 1 FROM moderation_cases WHERE reported_key=$1 OR reporter_key=$1", [reported.playerKey])).rowCount, 0);
  console.log("Moderation consent, identity binding, private triage, idempotency, removal, suspension, appeal, block and erasure passed.");
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(closePool);
