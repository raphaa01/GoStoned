import type { GameMessage } from "@/lib/game/chatService";
import type { GameState } from "@/lib/game/types";
import { ApiRequestError } from "./api";
import { assertResponseActor } from "./identityAuthority";

export type GameOpponent = Readonly<{
  playerKey: string;
  playerName: string;
}>;

export type GameChatSnapshot = Readonly<{
  available: boolean;
  messages: GameMessage[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(message: string): never {
  throw new ApiRequestError(message, {
    status: 502,
    code: "invalid_response",
  });
}

const PLAYER_KEY =
  /^(user|guest):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function parseGameMessage(value: unknown): GameMessage {
  if (!isRecord(value)) invalidResponse("A chat message is malformed.");
  const { id, playerKey, playerName, message, createdAt } = value;
  const createdAtTimestamp = typeof createdAt === "string"
    ? Date.parse(createdAt)
    : Number.NaN;
  if (
    typeof id !== "string"
    || !/^[1-9][0-9]*$/.test(id)
    || typeof playerKey !== "string"
    || !PLAYER_KEY.test(playerKey)
    || typeof playerName !== "string"
    || playerName.trim().length === 0
    || playerName.length > 80
    || typeof message !== "string"
    || message.trim().length === 0
    || message.length > 500
    || typeof createdAt !== "string"
    || !Number.isFinite(createdAtTimestamp)
    || new Date(createdAtTimestamp).toISOString() !== createdAt
  ) {
    invalidResponse("A chat message is malformed.");
  }
  return { id, playerKey, playerName, message, createdAt };
}

export function deriveGameOpponent(
  game: Pick<
    GameState,
    | "blackPlayerKey"
    | "whitePlayerKey"
    | "blackPlayerName"
    | "whitePlayerName"
  >,
  playerKey: string,
): GameOpponent | null {
  if (
    game.blackPlayerKey === playerKey
    && game.whitePlayerKey !== playerKey
  ) {
    return {
      playerKey: game.whitePlayerKey,
      playerName: game.whitePlayerName,
    };
  }
  if (
    game.whitePlayerKey === playerKey
    && game.blackPlayerKey !== playerKey
  ) {
    return {
      playerKey: game.blackPlayerKey,
      playerName: game.blackPlayerName,
    };
  }
  return null;
}

export function parsePlayerBlockState(
  value: unknown,
  expectedActor: string,
): boolean {
  if (!isRecord(value)) invalidResponse("The block response is malformed.");
  assertResponseActor(value.actor, expectedActor);
  if (typeof value.blocked !== "boolean") {
    invalidResponse("The block response has no authoritative state.");
  }
  return value.blocked;
}

export function parseSentGameMessage(
  value: unknown,
  expectedActor: string,
): GameMessage {
  if (!isRecord(value)) invalidResponse("The sent message response is malformed.");
  assertResponseActor(value.actor, expectedActor);
  const message = parseGameMessage(value.message);
  if (message.playerKey !== expectedActor) {
    invalidResponse("The sent message response has the wrong author.");
  }
  return message;
}

export function parseGameChatSnapshot(value: unknown): GameChatSnapshot {
  if (
    !isRecord(value)
    || typeof value.available !== "boolean"
    || !Array.isArray(value.messages)
    || value.messages.length > 100
    || (!value.available && value.messages.length !== 0)
  ) {
    invalidResponse("The chat response is malformed.");
  }
  const messages: GameMessage[] = [];
  for (let index = 0; index < value.messages.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value.messages, index)) {
      invalidResponse("The chat response contains a sparse message list.");
    }
    messages.push(parseGameMessage(value.messages[index]));
  }
  return { available: value.available, messages };
}
