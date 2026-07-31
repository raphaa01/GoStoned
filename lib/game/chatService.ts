import { query, withTransaction } from "@/lib/db";
import { containsBannedChatContent } from "@/lib/moderation/chatModeration";
import {
  isPlayerPairBlocked,
  lockPlayerPair,
  resolveGameOpponent,
} from "@/lib/moderation/playerBlockService";
import { GameServiceError } from "./gameService";

export type GameMessage = {
  id: string;
  playerKey: string;
  playerName: string;
  message: string;
  createdAt: string;
};

type MessageRow = {
  id: string | null;
  player_key: string | null;
  player_name: string | null;
  message: string | null;
  created_at: Date | null;
  available?: boolean;
};

function serializeMessage(row: MessageRow): GameMessage {
  if (
    row.id === null
    || row.player_key === null
    || row.player_name === null
    || row.message === null
    || row.created_at === null
  ) {
    throw new Error("A persisted chat message is incomplete.");
  }
  return {
    id: row.id,
    playerKey: row.player_key,
    playerName: row.player_name,
    message: row.message,
    createdAt: row.created_at.toISOString(),
  };
}

export async function getGameMessages(
  gameId: string,
  playerKey: string,
  afterId = 0,
): Promise<{ available: boolean; messages: GameMessage[] }> {
  const result = await query<MessageRow>(
    `WITH participant AS (
         SELECT CASE
                  WHEN black_player_key = $2 THEN white_player_key
                  ELSE black_player_key
                END AS opponent_key
          FROM games
          WHERE id = $1
            AND $2 IN (black_player_key, white_player_key)
            AND black_player_key <> white_player_key
       ), availability AS (
         SELECT participant.opponent_key NOT LIKE 'bot:%' AND NOT (
           EXISTS (
             SELECT 1 FROM player_blocks
              WHERE blocker_key = $2 AND blocked_key = participant.opponent_key
           ) OR EXISTS (
             SELECT 1 FROM player_blocks
              WHERE blocker_key = participant.opponent_key AND blocked_key = $2
           )
         ) AS available
           FROM participant
       )
       SELECT availability.available,
              message_rows.id::text, message_rows.player_key,
              message_rows.message, message_rows.created_at,
              message_rows.player_name
         FROM availability
         LEFT JOIN LATERAL (
           SELECT m.id, m.player_key, m.message, m.created_at,
                  COALESCE(
                    NULLIF(BTRIM(u.display_name), ''),
                    u.username,
                    'Guest ' || UPPER(RIGHT(m.player_key, 6))
                  ) AS player_name
             FROM game_messages m
             LEFT JOIN users u ON m.player_key = 'user:' || u.id::text
            WHERE availability.available
              AND m.game_id = $1 AND m.id > $3
            ORDER BY m.id
            LIMIT 100
         ) AS message_rows ON TRUE
        ORDER BY message_rows.id`,
    [gameId, playerKey, Math.max(0, afterId)],
  );
  const available = result.rows[0]?.available;
  if (available === undefined) {
    throw new GameServiceError("Game not found.", 404, "game_not_found");
  }
  return {
    available,
    messages: available
      ? result.rows.filter((row) => row.id !== null).map(serializeMessage)
      : [],
  };
}

export async function sendGameMessage(
  gameId: string,
  playerKey: string,
  messageValue: unknown,
): Promise<GameMessage> {
  const message = typeof messageValue === "string" ? messageValue.trim() : "";
  if (!message || message.length > 500) {
    throw new GameServiceError(
      "Messages must contain between 1 and 500 characters.",
      400,
      "invalid_message",
    );
  }
  if (containsBannedChatContent(message)) {
    throw new GameServiceError(
      "This message contains blocked language and was not sent.",
      400,
      "message_blocked",
    );
  }
  return withTransaction(async (client) => {
    const opponentKey = await resolveGameOpponent(client, gameId, playerKey);
    if (opponentKey.startsWith("bot:")) {
      throw new GameServiceError(
        "Chat is unavailable for bot games.",
        409,
        "chat_unavailable",
      );
    }
    await lockPlayerPair(client, playerKey, opponentKey);
    if (await isPlayerPairBlocked(client, playerKey, opponentKey)) {
      throw new GameServiceError(
        "Chat is unavailable for this game.",
        409,
        "chat_unavailable",
      );
    }
    const result = await client.query<MessageRow>(
      `WITH inserted AS (
         INSERT INTO game_messages (game_id, player_key, message)
         VALUES ($1, $2, $3)
         RETURNING id, player_key, message, created_at
       )
       SELECT i.id::text, i.player_key, i.message, i.created_at,
              COALESCE(
                NULLIF(BTRIM(u.display_name), ''),
                u.username,
                'Guest ' || UPPER(RIGHT(i.player_key, 6))
              ) AS player_name
         FROM inserted i
         LEFT JOIN users u ON i.player_key = 'user:' || u.id::text`,
      [gameId, playerKey, message],
    );
    return serializeMessage(result.rows[0]);
  });
}
