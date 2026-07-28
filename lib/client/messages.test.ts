import assert from "node:assert/strict";
import test from "node:test";
import type { GameMessage } from "@/lib/game/chatService";
import { latestGameMessageId, mergeGameMessages } from "./messages";

function message(id: number): GameMessage {
  return {
    id: String(id),
    playerKey: id % 2 ? "guest:black" : "guest:white",
    playerName: id % 2 ? "Black" : "White",
    message: `Message ${id}`,
    createdAt: `2026-07-28T10:00:${String(id).padStart(2, "0")}.000Z`,
  };
}

test("chat reconciliation deduplicates and orders stale poll and send responses", () => {
  const merged = mergeGameMessages(
    [message(6)],
    [message(1), message(2), message(3), message(4), message(5), message(6)],
  );
  assert.deepEqual(merged.map(({ id }) => id), ["1", "2", "3", "4", "5", "6"]);
  assert.equal(latestGameMessageId(merged), 6);
});

test("a duplicate send response remains one message", () => {
  const merged = mergeGameMessages([message(1), message(2)], [message(2)]);
  assert.deepEqual(merged.map(({ id }) => id), ["1", "2"]);
});
