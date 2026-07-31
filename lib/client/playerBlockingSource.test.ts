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

test("blocked chat is a monotonic client access boundary", () => {
  const room = source("components/game/GameRoom.tsx");
  const refresh = section(room, "const refreshChat", "const applyChatMessages");
  const apply = section(room, "const applyChatMessages", "const closeChatForPolicy");
  const close = section(room, "const closeChatForPolicy", "useEffect(() => {");
  const poll = section(room, "const pollChat", "const requestImmediateChatSync");

  assert.match(refresh, /\[EXPECTED_PLAYER_HEADER\]: playerKey/);
  assert.match(refresh, /chatAccessGeneration\.current !== accessGeneration/);
  assert.match(refresh, /parseGameChatSnapshot\(data\)/);
  assert.match(apply, /chatAccessGeneration\.current !== accessGeneration/);
  assert.match(close, /chatAccessGeneration\.current \+= 1/);
  assert.match(close, /chatPolicyUnavailableRef\.current = true/);
  assert.match(close, /setMessages\(\[\]\)/);
  assert.match(poll, /if \(!snapshot\.available\) \{\s+closeChatForPolicy\(\)/);
  assert.match(poll, /chatAccessGeneration\.current === accessGeneration/);
  assert.match(poll, /BLOCKED_CHAT_RECHECK_MS/);
  assert.match(poll, /setChatPolicyUnavailable\(false\)/);
});

test("block mutations are targetless, actor-bound, and restart chat only after unblock", () => {
  const room = source("components/game/GameRoom.tsx");
  const mutation = section(
    room,
    "async function updateOpponentBlock",
    "async function clearFinishedGame",
  );

  assert.match(mutation, /method: blocked \? "POST" : "DELETE"/);
  assert.match(mutation, /\[EXPECTED_PLAYER_HEADER\]: playerKey/);
  assert.match(mutation, /parsePlayerBlockState\(data, playerKey\)/);
  assert.doesNotMatch(mutation, /body:/);
  assert.doesNotMatch(mutation, /opponent\.playerKey/);
  assert.match(mutation, /if \(authoritativeState\) \{[\s\S]+closeChatForPolicy\(\)/);
  assert.match(mutation, /immediateChatSync\.current\?\.\(\)/);
  assert.match(mutation, /setBlockedByYou\(previousState\)/);
  assert.match(mutation, /blockReconciliationPending\.current = true/);
  assert.match(mutation, /blockReadGeneration\.current \+= 1/);
  assert.match(mutation, /setBlockedByYou\(null\)/);
  assert.match(mutation, /setBlockReadNonce\(\(value\) => value \+ 1\)/);
});

test("stale send failures cannot close a newer chat access generation", () => {
  const room = source("components/game/GameRoom.tsx");
  const send = section(room, "async function sendMessage", "async function updateOpponentBlock");
  const identityFailure = send.indexOf('requestError.code === "identity_changed"');
  const terminalFailure = send.indexOf("[401, 403, 404].includes(requestError.status)");
  const staleBoundary = send.indexOf(
    "if (chatAccessGeneration.current !== accessGeneration) throw requestError;",
    terminalFailure,
  );
  const policyFailure = send.indexOf('requestError.code === "chat_unavailable"');

  assert.ok(identityFailure >= 0);
  assert.ok(identityFailure < terminalFailure);
  assert.ok(terminalFailure < staleBoundary);
  assert.ok(staleBoundary < policyFailure);
});

test("blocking UI keeps direction private and restores focus safely", () => {
  const room = source("components/game/GameRoom.tsx");
  const chat = source("components/game/ChatPanel.tsx");
  const styles = source("app/globals.css");

  assert.match(chat, /aria-pressed=\{blockedByYou === null \? undefined : blockedByYou\}/);
  assert.match(chat, /formRef\.current\?\.contains\(document\.activeElement\)/);
  assert.match(chat, /role="status"\s+tabIndex=\{-1\}/);
  assert.match(chat, /copy\.chatPolicyUnavailable/);
  assert.match(chat, /sendError\.code !== "chat_unavailable"/);
  assert.doesNotMatch(chat, /blocked by|hat dich blockiert/i);
  assert.match(room, /finalFocusRef=\{confirmation === "block" \? blockActionRef : undefined\}/);
  assert.match(room, /copy\.blockDescription/);
  assert.match(room, /copy\.blockedSuccess/);
  assert.match(room, /blockReconciling=\{blockReconciling\}/);
  assert.match(room, /setBlockAnnouncement\(\s*state\s*\? copy\.blockStateRefreshedBlocked\s*:\s*copy\.blockStateRefreshedUnblocked/);
  assert.match(chat, /blockError && !blockReconciling/);
  assert.match(chat, /aria-disabled=\{blockActionUnavailable\}/);
  assert.match(chat, /disabled=\{blockActionUnavailable && !blockReconciling\}/);
  assert.match(chat, /if \(blockActionUnavailable\) return/);
  assert.match(styles, /\.chat-safety-action\s*\{[\s\S]+min-height:\s*44px/);
  assert.match(styles, /\.chat-safety-action\[aria-disabled="true"\]/);
  assert.match(styles, /\.chat-form\s*\{[\s\S]+grid-template-columns:\s*1fr 44px/);
  assert.match(styles, /\.chat-form input\s*\{[\s\S]+min-height:\s*44px/);
  assert.match(styles, /\.modal-close\s*\{[\s\S]+height:\s*44px[\s\S]+width:\s*44px/);
  assert.match(styles, /\.confirm-modal-actions \.button\s*\{\s*min-height:\s*44px/);
});
