import { query } from "@/lib/db";
import { containsBannedChatContent } from "@/lib/moderation/chatModeration";
import { GameServiceError } from "./gameService";

export type GameMessage = {
  id: string;
  playerKey: string;
  playerName: string;
  message: string;
  createdAt: string;
};

type ParticipantRow = {
  black_player_key: string;
  white_player_key: string;
};

type MessageRow = {
  id: string;
  player_key: string;
  player_name: string;
  message: string;
  created_at: Date;
};

async function assertGameParticipant(gameId: string, playerKey: string) {
  const result = await query<ParticipantRow>(
    `SELECT black_player_key, white_player_key
       FROM games
      WHERE id = $1`,
    [gameId],
  );
  const game = result.rows[0];
  if (!game) throw new GameServiceError("Game not found.", 404, "game_not_found");
  if (game.black_player_key !== playerKey && game.white_player_key !== playerKey) {
    throw new GameServiceError("You are not a participant in this game.", 403, "not_participant");
  }
}

function serializeMessage(row: MessageRow): GameMessage {
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
): Promise<GameMessage[]> {
  await assertGameParticipant(gameId, playerKey);
  const result = await query<MessageRow>(
    `SELECT m.id::text, m.player_key, m.message, m.created_at,
            COALESCE(
              NULLIF(BTRIM(u.display_name), ''),
              u.username,
              'Guest ' || UPPER(RIGHT(m.player_key, 6))
            ) AS player_name
       FROM game_messages m
       LEFT JOIN users u ON m.player_key = 'user:' || u.id::text
      WHERE m.game_id = $1 AND m.id > $2
      ORDER BY m.id
      LIMIT 100`,
    [gameId, Math.max(0, afterId)],
  );
  return result.rows.map(serializeMessage);
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
  await assertGameParticipant(gameId, playerKey);
  const result = await query<MessageRow>(
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
}
