import type { PoolClient, QueryResultRow } from "pg";
import { query, withTransaction } from "@/lib/db";
import { getTimeControl } from "@/lib/game/timeControls";
import type { BoardSize, TimeControlId } from "@/lib/game/types";
import { GameServiceError } from "@/lib/game/gameServiceError";
import { DEFAULT_MATCH_RULES } from "@/lib/game/rulesPolicy";
import { containsBannedChatContent } from "@/lib/moderation/chatModeration";
import { isPlayerPairBlocked, lockPlayerPair } from "@/lib/moderation/playerBlockService";
import { isProfileAvatarStyle } from "@/lib/profileAvatar";
import type {
  FriendGameInvite,
  FriendMessage,
  FriendProfile,
  FriendRequestSummary,
  FriendsDashboard,
  FriendSummary,
  PlayerSearchResult,
} from "./types";

type PlayerRow = QueryResultRow & {
  user_id: string;
  username: string;
  display_name: string;
  avatar_style: string;
  presence: "online" | "playing" | "offline";
};

type FriendshipRow = QueryResultRow & {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
  created_at: Date;
};

type DashboardFriendRow = PlayerRow & {
  friendship_id: string;
  unread_count: string | number;
  last_message: string | null;
  last_message_at: Date | null;
};

type RequestRow = PlayerRow & {
  friendship_id: string;
  direction: "incoming" | "outgoing";
  created_at: Date;
};

type InviteRow = QueryResultRow & {
  id: string;
  friendship_id: string;
  inviter_id: string;
  invitee_id: string;
  other_player_name: string;
  board_size: BoardSize;
  time_control: TimeControlId;
  status: FriendGameInvite["status"];
  game_id: string | null;
  created_at: Date;
  expires_at: Date;
};

type MessageRow = QueryResultRow & {
  id: string;
  friendship_id: string;
  sender_id: string;
  sender_name: string;
  message: string;
  created_at: Date;
};

function playerKey(userId: string): string {
  return `user:${userId}`;
}

async function lockPlayerGameActivity(client: PoolClient, userIds: readonly string[]): Promise<void> {
  for (const userId of [...new Set(userIds)].sort()) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`active-game-player:v1:${playerKey(userId)}`],
    );
  }
}

function avatarStyle(value: string) {
  return isProfileAvatarStyle(value) ? value : "kifu-classic";
}

function notFound(): never {
  throw new GameServiceError("Friendship not found.", 404, "friendship_not_found");
}

function relationshipStatus(row: FriendshipRow | undefined, actorId: string) {
  if (!row) return "none" as const;
  if (row.status === "accepted") return "friends" as const;
  return row.requester_id === actorId ? "outgoing" as const : "incoming" as const;
}

async function friendshipForActor(
  client: PoolClient,
  friendshipId: string,
  actorId: string,
  accepted = false,
  forUpdate = false,
): Promise<FriendshipRow> {
  const result = await client.query<FriendshipRow>(
    `SELECT id,requester_id,addressee_id,status,created_at
       FROM friendships
      WHERE id=$1 AND $2 IN (requester_id,addressee_id)
        ${accepted ? "AND status='accepted'" : ""}
      ${forUpdate ? "FOR UPDATE" : ""}`,
    [friendshipId, actorId],
  );
  return result.rows[0] ?? notFound();
}

async function lockFriendshipForActor(
  client: PoolClient,
  friendshipId: string,
  actorId: string,
  accepted = false,
): Promise<FriendshipRow> {
  const snapshot = await friendshipForActor(client, friendshipId, actorId, accepted);
  await lockPlayerPair(client, playerKey(actorId), playerKey(otherId(snapshot, actorId)));
  return friendshipForActor(client, friendshipId, actorId, accepted, true);
}

function otherId(friendship: FriendshipRow, actorId: string): string {
  return friendship.requester_id === actorId
    ? friendship.addressee_id
    : friendship.requester_id;
}

function serializeInvite(row: InviteRow, actorId: string): FriendGameInvite {
  return {
    id: row.id,
    friendshipId: row.friendship_id,
    inviterId: row.inviter_id,
    inviteeId: row.invitee_id,
    otherPlayerName: row.other_player_name,
    boardSize: row.board_size,
    timeControl: row.time_control,
    direction: row.inviter_id === actorId ? "outgoing" : "incoming",
    status: row.status,
    gameId: row.game_id,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

export async function getFriendsDashboard(actorId: string): Promise<FriendsDashboard> {
  await query(
    `UPDATE friend_game_invites
        SET status='expired',responded_at=statement_timestamp()
      WHERE status='pending' AND expires_at <= statement_timestamp()
        AND $1 IN (inviter_id,invitee_id)`,
    [actorId],
  );
  const [friendsResult, requestsResult, invitesResult] = await Promise.all([
    query<DashboardFriendRow>(
      `SELECT friendship.id AS friendship_id, other.id::text AS user_id,
              other.username,
              COALESCE(NULLIF(BTRIM(other.display_name),''),other.username) AS display_name,
              other.avatar_style,
              CASE WHEN EXISTS (
                SELECT 1 FROM games active
                 WHERE active.status='active'
                   AND ('user:' || other.id::text) IN (active.black_player_key,active.white_player_key)
              ) THEN 'playing'
              WHEN EXISTS (
                SELECT 1 FROM user_sessions session
                 WHERE session.user_id=other.id
                   AND session.expires_at > statement_timestamp()
                   AND session.last_seen_at > statement_timestamp() - INTERVAL '3 minutes'
              ) THEN 'online' ELSE 'offline' END AS presence,
              (SELECT COUNT(*) FROM friend_messages unread
                WHERE unread.friendship_id=friendship.id
                  AND unread.sender_id=other.id AND unread.read_at IS NULL) AS unread_count,
              latest.message AS last_message,latest.created_at AS last_message_at
         FROM friendships friendship
         JOIN users other ON other.id=CASE WHEN friendship.requester_id=$1
           THEN friendship.addressee_id ELSE friendship.requester_id END
         LEFT JOIN LATERAL (
           SELECT message,created_at FROM friend_messages
            WHERE friendship_id=friendship.id ORDER BY id DESC LIMIT 1
         ) latest ON TRUE
        WHERE friendship.status='accepted'
          AND $1 IN (friendship.requester_id,friendship.addressee_id)
        ORDER BY (latest.created_at IS NULL),latest.created_at DESC,LOWER(other.username)`,
      [actorId],
    ),
    query<RequestRow>(
      `SELECT friendship.id AS friendship_id,other.id::text AS user_id,other.username,
              COALESCE(NULLIF(BTRIM(other.display_name),''),other.username) AS display_name,
              other.avatar_style,'offline'::text AS presence,
              CASE WHEN friendship.addressee_id=$1 THEN 'incoming' ELSE 'outgoing' END AS direction,
              friendship.created_at
         FROM friendships friendship
         JOIN users other ON other.id=CASE WHEN friendship.requester_id=$1
           THEN friendship.addressee_id ELSE friendship.requester_id END
        WHERE friendship.status='pending'
          AND $1 IN (friendship.requester_id,friendship.addressee_id)
        ORDER BY friendship.created_at DESC`,
      [actorId],
    ),
    query<InviteRow>(
      `SELECT invite.id,invite.friendship_id,invite.inviter_id,invite.invitee_id,
              invite.board_size,invite.time_control,invite.status,invite.game_id,
              invite.created_at,invite.expires_at,
              COALESCE(NULLIF(BTRIM(other.display_name),''),other.username) AS other_player_name
         FROM friend_game_invites invite
         JOIN users other ON other.id=CASE WHEN invite.inviter_id=$1
           THEN invite.invitee_id ELSE invite.inviter_id END
        WHERE $1 IN (invite.inviter_id,invite.invitee_id)
          AND (invite.status='pending'
            OR (invite.status='accepted'
                AND invite.responded_at > statement_timestamp() - INTERVAL '10 minutes'
                AND EXISTS (
                  SELECT 1 FROM games accepted_game
                   WHERE accepted_game.id=invite.game_id
                     AND accepted_game.status='active'
                )))
        ORDER BY invite.created_at DESC LIMIT 50`,
      [actorId],
    ),
  ]);

  const friends: FriendSummary[] = friendsResult.rows.map((row) => ({
    friendshipId: row.friendship_id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarStyle: avatarStyle(row.avatar_style),
    presence: row.presence,
    unreadCount: Number(row.unread_count),
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at?.toISOString() ?? null,
  }));
  const requests: FriendRequestSummary[] = requestsResult.rows.map((row) => ({
    friendshipId: row.friendship_id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarStyle: avatarStyle(row.avatar_style),
    direction: row.direction,
    createdAt: row.created_at.toISOString(),
  }));
  return { friends, requests, invites: invitesResult.rows.map((row) => serializeInvite(row, actorId)) };
}

export async function searchPlayers(actorId: string, term: string): Promise<PlayerSearchResult[]> {
  const result = await query<PlayerRow & FriendshipRow & { friendship_id: string | null }>(
    `SELECT candidate.id::text AS user_id,candidate.username,
            COALESCE(NULLIF(BTRIM(candidate.display_name),''),candidate.username) AS display_name,
            candidate.avatar_style,
            CASE WHEN EXISTS (
              SELECT 1 FROM games active WHERE active.status='active'
                AND ('user:' || candidate.id::text) IN (active.black_player_key,active.white_player_key)
            ) THEN 'playing'
            WHEN EXISTS (
              SELECT 1 FROM user_sessions session WHERE session.user_id=candidate.id
                AND session.expires_at > statement_timestamp()
                AND session.last_seen_at > statement_timestamp() - INTERVAL '3 minutes'
            ) THEN 'online' ELSE 'offline' END AS presence,
            friendship.id AS friendship_id,friendship.requester_id,
            friendship.addressee_id,friendship.status,friendship.created_at
       FROM users candidate
       LEFT JOIN friendships friendship ON
         (friendship.requester_id=$1 AND friendship.addressee_id=candidate.id)
         OR (friendship.addressee_id=$1 AND friendship.requester_id=candidate.id)
      WHERE candidate.id<>$1
        AND (LOWER(candidate.username) LIKE LOWER($2) || '%'
          OR LOWER(COALESCE(candidate.display_name,'')) LIKE LOWER($2) || '%')
        AND NOT EXISTS (
          SELECT 1 FROM player_blocks block
           WHERE (block.blocker_key='user:' || $1::uuid::text AND block.blocked_key='user:' || candidate.id::text)
              OR (block.blocker_key='user:' || candidate.id::text AND block.blocked_key='user:' || $1::uuid::text)
        )
      ORDER BY (LOWER(candidate.username)=LOWER($2)) DESC,LOWER(candidate.username)
      LIMIT 20`,
    [actorId, term],
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarStyle: avatarStyle(row.avatar_style),
    presence: row.presence,
    friendshipId: row.friendship_id,
    friendshipStatus: relationshipStatus(row.friendship_id ? row : undefined, actorId),
  }));
}

export async function sendFriendRequest(actorId: string, targetId: string): Promise<string> {
  if (actorId === targetId) {
    throw new GameServiceError("You cannot add yourself.", 400, "cannot_friend_self");
  }
  return withTransaction(async (client) => {
    await lockPlayerPair(client, playerKey(actorId), playerKey(targetId));
    if (await isPlayerPairBlocked(client, playerKey(actorId), playerKey(targetId))) {
      throw new GameServiceError("This player is unavailable.", 409, "player_unavailable");
    }
    const target = await client.query("SELECT 1 FROM users WHERE id=$1", [targetId]);
    if (target.rowCount !== 1) {
      throw new GameServiceError("Player not found.", 404, "player_not_found");
    }
    const existing = await client.query<FriendshipRow>(
      `SELECT id,requester_id,addressee_id,status,created_at FROM friendships
        WHERE (requester_id=$1 AND addressee_id=$2)
           OR (requester_id=$2 AND addressee_id=$1) FOR UPDATE`,
      [actorId, targetId],
    );
    const relationship = existing.rows[0];
    if (relationship?.status === "accepted") {
      throw new GameServiceError("You are already friends.", 409, "already_friends");
    }
    if (relationship?.requester_id === actorId) return relationship.id;
    if (relationship) {
      await client.query(
        `UPDATE friendships SET status='accepted',responded_at=statement_timestamp(),
                updated_at=statement_timestamp() WHERE id=$1`,
        [relationship.id],
      );
      return relationship.id;
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO friendships(requester_id,addressee_id) VALUES ($1,$2) RETURNING id`,
      [actorId, targetId],
    );
    return created.rows[0].id;
  });
}

export async function respondToFriendRequest(
  actorId: string,
  friendshipId: string,
  accept: boolean,
): Promise<void> {
  await withTransaction(async (client) => {
    const friendship = await lockFriendshipForActor(client, friendshipId, actorId);
    if (friendship.status !== "pending" || friendship.addressee_id !== actorId) notFound();
    if (accept) {
      if (await isPlayerPairBlocked(client, playerKey(friendship.requester_id), playerKey(actorId))) {
        throw new GameServiceError("This player is unavailable.", 409, "player_unavailable");
      }
      await client.query(
        `UPDATE friendships SET status='accepted',responded_at=statement_timestamp(),
                updated_at=statement_timestamp() WHERE id=$1`,
        [friendshipId],
      );
    } else {
      await client.query("DELETE FROM friendships WHERE id=$1", [friendshipId]);
    }
  });
}

export async function removeFriendship(actorId: string, friendshipId: string): Promise<void> {
  await withTransaction(async (client) => {
    await lockFriendshipForActor(client, friendshipId, actorId);
    await client.query("DELETE FROM friendships WHERE id=$1", [friendshipId]);
  });
}

export async function getFriendMessages(
  actorId: string,
  friendshipId: string,
  afterId: number,
): Promise<FriendMessage[]> {
  return withTransaction(async (client) => {
    const friendship = await lockFriendshipForActor(client, friendshipId, actorId, true);
    const partnerId = otherId(friendship, actorId);
    if (await isPlayerPairBlocked(client, playerKey(actorId), playerKey(partnerId))) {
      throw new GameServiceError("Chat is unavailable.", 409, "chat_unavailable");
    }
    await client.query(
      `UPDATE friend_messages SET read_at=statement_timestamp()
        WHERE friendship_id=$1 AND sender_id<>$2 AND read_at IS NULL`,
      [friendshipId, actorId],
    );
    const result = await client.query<MessageRow>(
      `SELECT message.id::text,message.friendship_id,message.sender_id,
              COALESCE(NULLIF(BTRIM(sender.display_name),''),sender.username) AS sender_name,
              message.message,message.created_at
         FROM friend_messages message JOIN users sender ON sender.id=message.sender_id
        WHERE message.friendship_id=$1 AND message.id>$2
        ORDER BY message.id LIMIT 100`,
      [friendshipId, Math.max(0, afterId)],
    );
    return result.rows.map((row) => ({
      id: row.id,
      friendshipId: row.friendship_id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      message: row.message,
      createdAt: row.created_at.toISOString(),
    }));
  });
}

export async function sendFriendMessage(
  actorId: string,
  friendshipId: string,
  value: unknown,
): Promise<FriendMessage> {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message || message.length > 500) {
    throw new GameServiceError("Messages must contain between 1 and 500 characters.", 400, "invalid_message");
  }
  if (containsBannedChatContent(message)) {
    throw new GameServiceError("This message contains blocked language.", 400, "message_blocked");
  }
  return withTransaction(async (client) => {
    const friendship = await lockFriendshipForActor(client, friendshipId, actorId, true);
    const partnerId = otherId(friendship, actorId);
    if (await isPlayerPairBlocked(client, playerKey(actorId), playerKey(partnerId))) {
      throw new GameServiceError("Chat is unavailable.", 409, "chat_unavailable");
    }
    const result = await client.query<MessageRow>(
      `WITH inserted AS (
         INSERT INTO friend_messages(friendship_id,sender_id,message)
         VALUES ($1,$2,$3) RETURNING *
       ) SELECT inserted.id::text,inserted.friendship_id,inserted.sender_id,
                COALESCE(NULLIF(BTRIM(sender.display_name),''),sender.username) AS sender_name,
                inserted.message,inserted.created_at
           FROM inserted JOIN users sender ON sender.id=inserted.sender_id`,
      [friendshipId, actorId, message],
    );
    const row = result.rows[0];
    return { id: row.id, friendshipId: row.friendship_id, senderId: row.sender_id,
      senderName: row.sender_name, message: row.message, createdAt: row.created_at.toISOString() };
  });
}

export async function createGameInvite(
  actorId: string,
  friendshipId: string,
  boardSize: BoardSize,
  timeControl: TimeControlId,
): Promise<FriendGameInvite> {
  return withTransaction(async (client) => {
    const friendship = await lockFriendshipForActor(client, friendshipId, actorId, true);
    const inviteeId = otherId(friendship, actorId);
    if (await isPlayerPairBlocked(client, playerKey(actorId), playerKey(inviteeId))) {
      throw new GameServiceError("This player is unavailable.", 409, "player_unavailable");
    }
    await client.query(
      `UPDATE friend_game_invites SET status='expired',responded_at=statement_timestamp()
        WHERE status='pending' AND expires_at<=statement_timestamp()
          AND inviter_id=$1 AND invitee_id=$2`,
      [actorId, inviteeId],
    );
    const result = await client.query<InviteRow>(
      `INSERT INTO friend_game_invites(
         friendship_id,inviter_id,invitee_id,board_size,time_control,expires_at
       ) VALUES ($1,$2,$3,$4,$5,statement_timestamp() + INTERVAL '5 minutes')
       RETURNING id,friendship_id,inviter_id,invitee_id,board_size,time_control,status,
         game_id,created_at,expires_at,
         (SELECT COALESCE(NULLIF(BTRIM(display_name),''),username) FROM users WHERE id=$3)
           AS other_player_name`,
      [friendshipId, actorId, inviteeId, boardSize, timeControl],
    );
    return serializeInvite(result.rows[0], actorId);
  }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new GameServiceError("An invitation is already pending.", 409, "invite_already_pending");
    }
    throw error;
  });
}

export async function respondToGameInvite(
  actorId: string,
  inviteId: string,
  action: "accept" | "decline" | "cancel",
): Promise<{ gameId: string | null }> {
  return withTransaction(async (client) => {
    const snapshotResult = await client.query<InviteRow>(
      `SELECT invite.id,invite.friendship_id,invite.inviter_id,invite.invitee_id,
              invite.board_size,invite.time_control,invite.status,invite.game_id,
              invite.created_at,invite.expires_at,''::text AS other_player_name
         FROM friend_game_invites invite
        WHERE invite.id=$1 AND $2 IN (invite.inviter_id,invite.invitee_id)`,
      [inviteId, actorId],
    );
    const snapshot = snapshotResult.rows[0];
    if (!snapshot) notFound();
    if (snapshot.status === "accepted") return { gameId: snapshot.game_id };
    if (snapshot.status !== "pending") {
      throw new GameServiceError("This invitation is no longer pending.", 409, "invite_not_pending");
    }
    if (action === "cancel" && snapshot.inviter_id !== actorId) notFound();
    if (action !== "cancel" && snapshot.invitee_id !== actorId) notFound();
    if (action === "accept") {
      await lockPlayerGameActivity(client, [snapshot.inviter_id, snapshot.invitee_id]);
    }
    await lockPlayerPair(client, playerKey(snapshot.inviter_id), playerKey(snapshot.invitee_id));
    const lockedResult = await client.query<InviteRow>(
      `SELECT invite.id,invite.friendship_id,invite.inviter_id,invite.invitee_id,
              invite.board_size,invite.time_control,invite.status,invite.game_id,
              invite.created_at,invite.expires_at,''::text AS other_player_name
         FROM friend_game_invites invite
        WHERE invite.id=$1 AND $2 IN (invite.inviter_id,invite.invitee_id) FOR UPDATE`,
      [inviteId, actorId],
    );
    const invite = lockedResult.rows[0];
    if (!invite) notFound();
    if (invite.status === "accepted") return { gameId: invite.game_id };
    if (invite.status !== "pending") {
      throw new GameServiceError("This invitation is no longer pending.", 409, "invite_not_pending");
    }
    if (invite.expires_at.getTime() <= Date.now()) {
      await client.query(
        `UPDATE friend_game_invites SET status='expired',responded_at=statement_timestamp() WHERE id=$1`,
        [inviteId],
      );
      throw new GameServiceError("This invitation has expired.", 409, "invite_expired");
    }
    if (action === "cancel") {
      if (invite.inviter_id !== actorId) notFound();
      await client.query(
        `UPDATE friend_game_invites SET status='cancelled',responded_at=statement_timestamp() WHERE id=$1`,
        [inviteId],
      );
      return { gameId: null };
    }
    if (invite.invitee_id !== actorId) notFound();
    if (action === "decline") {
      await client.query(
        `UPDATE friend_game_invites SET status='declined',responded_at=statement_timestamp() WHERE id=$1`,
        [inviteId],
      );
      return { gameId: null };
    }

    const friendship = await friendshipForActor(client, invite.friendship_id, actorId, true, true);
    if (otherId(friendship, actorId) !== invite.inviter_id) notFound();
    if (await isPlayerPairBlocked(client, playerKey(invite.inviter_id), playerKey(invite.invitee_id))) {
      throw new GameServiceError("This player is unavailable.", 409, "player_unavailable");
    }
    const participantKeys = [playerKey(invite.inviter_id), playerKey(invite.invitee_id)];
    await client.query(
      `SELECT player_key FROM matchmaking_queue
        WHERE player_key=ANY($1::text[]) ORDER BY player_key FOR UPDATE`,
      [participantKeys],
    );
    const active = await client.query(
      `SELECT 1 FROM games WHERE status='active'
        AND (black_player_key=ANY($1::text[]) OR white_player_key=ANY($1::text[]))
        LIMIT 1 FOR UPDATE`,
      [participantKeys],
    );
    if (active.rowCount) {
      throw new GameServiceError("One of you is already in a game.", 409, "player_in_game");
    }
    const time = getTimeControl(invite.time_control);
    const inviterIsBlack = Number.parseInt(invite.id[0], 16) % 2 === 0;
    const black = playerKey(inviterIsBlack ? invite.inviter_id : invite.invitee_id);
    const white = playerKey(inviterIsBlack ? invite.invitee_id : invite.inviter_id);
    const rules = DEFAULT_MATCH_RULES;
    const game = await client.query<{ id: string }>(
      `INSERT INTO games(
         game_type,board_size,black_player_key,white_player_key,time_control,
         rules,rules_profile,scoring_method,komi,handicap,phase,to_move,
         main_time_seconds,byo_yomi_periods,byo_yomi_seconds,
         black_time_remaining_ms,white_time_remaining_ms,
         black_periods_remaining,white_periods_remaining,turn_started_at
       ) VALUES (
         'friendly',$1,$2,$3,$4,$5,$6,$7,$8,$9,'play','black',
         $10,$11,$12,$13,$13,$11,$11,statement_timestamp()
       ) RETURNING id`,
      [invite.board_size, black, white, invite.time_control, rules.ruleset,
        rules.rulesProfile, rules.scoringMethod, rules.komi, rules.handicap,
        time.mainTimeSeconds, time.byoYomiPeriods, time.byoYomiSeconds,
        time.mainTimeSeconds * 1_000],
    );
    const gameId = game.rows[0].id;
    await client.query(
      `UPDATE friend_game_invites SET status='accepted',game_id=$2,
              responded_at=statement_timestamp() WHERE id=$1`,
      [inviteId, gameId],
    );
    await client.query(
      `DELETE FROM matchmaking_queue WHERE player_key=ANY($1::text[]) AND status='waiting'`,
      [participantKeys],
    );
    return { gameId };
  });
}

export async function getFriendProfile(actorId: string, targetId: string): Promise<FriendProfile> {
  const result = await query<QueryResultRow & {
    user_id: string; username: string; display_name: string; avatar_style: string;
    presence: "online" | "playing" | "offline"; joined_at: Date;
    rating: string | number | null; rated_games: number; friendly_games: string | number;
    shared_friendly_games: string | number; friendship_id: string | null;
    requester_id: string | null; addressee_id: string | null; friendship_status: "pending" | "accepted" | null;
  }>(
    `SELECT target.id::text AS user_id,target.username,
            COALESCE(NULLIF(BTRIM(target.display_name),''),target.username) AS display_name,
            target.avatar_style,target.created_at AS joined_at,
            CASE WHEN EXISTS (SELECT 1 FROM games active WHERE active.status='active'
              AND ('user:' || target.id::text) IN (active.black_player_key,active.white_player_key))
              THEN 'playing'
              WHEN EXISTS (SELECT 1 FROM user_sessions session WHERE session.user_id=target.id
                AND session.expires_at>statement_timestamp()
                AND session.last_seen_at>statement_timestamp()-INTERVAL '3 minutes')
              THEN 'online' ELSE 'offline' END AS presence,
            rating.rating::double precision AS rating,COALESCE(rating.rated_game_count,0) AS rated_games,
            (SELECT COUNT(*) FROM games game WHERE game.game_type='friendly' AND game.status='finished'
              AND ('user:' || target.id::text) IN (game.black_player_key,game.white_player_key)) AS friendly_games,
            (SELECT COUNT(*) FROM games game WHERE game.game_type='friendly' AND game.status='finished'
              AND ('user:' || target.id::text) IN (game.black_player_key,game.white_player_key)
              AND ('user:' || $1::uuid::text) IN (game.black_player_key,game.white_player_key)) AS shared_friendly_games,
            friendship.id AS friendship_id,friendship.requester_id,friendship.addressee_id,
            friendship.status AS friendship_status
       FROM users target
       LEFT JOIN player_glicko2_ratings rating ON rating.user_id=target.id
       LEFT JOIN friendships friendship ON
         (friendship.requester_id=$1 AND friendship.addressee_id=target.id)
         OR (friendship.addressee_id=$1 AND friendship.requester_id=target.id)
      WHERE target.id=$2 AND NOT EXISTS (
        SELECT 1 FROM player_blocks block WHERE
          (block.blocker_key='user:' || $1::uuid::text AND block.blocked_key='user:' || target.id::text)
          OR (block.blocker_key='user:' || target.id::text AND block.blocked_key='user:' || $1::uuid::text)
      )`,
    [actorId, targetId],
  );
  const row = result.rows[0];
  if (!row) throw new GameServiceError("Player not found.", 404, "player_not_found");
  const relation = row.friendship_id ? {
    id: row.friendship_id, requester_id: row.requester_id!, addressee_id: row.addressee_id!,
    status: row.friendship_status!, created_at: row.joined_at,
  } : undefined;
  return {
    userId: row.user_id,username: row.username,displayName: row.display_name,
    avatarStyle: avatarStyle(row.avatar_style),presence: row.presence,joinedAt: row.joined_at.toISOString(),
    rating: row.rating === null ? null : Number(row.rating),ratedGames: row.rated_games,
    friendlyGames: Number(row.friendly_games),sharedFriendlyGames: Number(row.shared_friendly_games),
    friendshipId: row.friendship_id,friendshipStatus: relationshipStatus(relation, actorId),
  };
}
