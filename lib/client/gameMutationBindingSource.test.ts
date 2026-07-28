import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function section(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `${start} section must exist`);
  return value.slice(startIndex, endIndex);
}

test("game mutation clients bind and verify the displayed player", () => {
  const room = source("components/game/GameRoom.tsx");
  const leave = source("lib/client/leaveGame.ts");

  for (const operation of [
    section(room, "async function makeMove", "async function resign"),
    section(room, "async function resign", "async function scoringAction"),
    section(room, "async function scoringAction", "async function sendMessage"),
    section(room, "async function clearFinishedGame", "async function leaveGameRoom"),
  ]) {
    assert.match(operation, /\[EXPECTED_PLAYER_HEADER\]: playerKey/);
    assert.match(operation, /assertResponseActor\([^,]+, playerKey\)/);
  }
  const chat = section(room, "async function sendMessage", "async function clearFinishedGame");
  assert.match(chat, /\[EXPECTED_PLAYER_HEADER\]: playerKey/);
  assert.match(chat, /parseSentGameMessage\(data, playerKey\)/);
  assert.match(chat, /requestError\.code === "identity_changed"[\s\S]+recoverChangedIdentity\(\)/);
  const recovery = section(room, "function recoverChangedIdentity", "function refreshChangedIdentity");
  assert.doesNotMatch(recovery, /refreshIdentity/);
  assert.match(room, /if \(identityChanged\) recoveryAction\.current\?\.focus\(\)/);
  assert.match(room, /<p role="alert">/);
  assert.match(room, /ref=\{recoveryAction\}/);
  assert.equal(
    leave.match(/assertResponseActor\([^,]+, expectedPlayerKey\)/g)?.length,
    2,
  );
});
