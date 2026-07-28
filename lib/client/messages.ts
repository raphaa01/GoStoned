import type { GameMessage } from "@/lib/game/chatService";

function numericId(message: GameMessage): number {
  const value = Number(message.id);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function mergeGameMessages(
  current: readonly GameMessage[],
  incoming: readonly GameMessage[],
): GameMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => numericId(left) - numericId(right));
}

export function latestGameMessageId(messages: readonly GameMessage[]): number {
  return messages.reduce((latest, message) => Math.max(latest, numericId(message)), 0);
}
