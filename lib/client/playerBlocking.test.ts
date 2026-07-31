import assert from "node:assert/strict";
import test from "node:test";
import { de } from "@/lib/i18n/catalogs/de";
import { en } from "@/lib/i18n/catalogs/en";
import { ApiRequestError } from "./api";
import {
  deriveGameOpponent,
  parseGameChatSnapshot,
  parsePlayerBlockState,
  parseSentGameMessage,
} from "./playerBlocking";

const black = "user:11111111-1111-4111-8111-111111111111";
const white = "guest:22222222-2222-4222-8222-222222222222";
const participants = {
  blackPlayerKey: black,
  whitePlayerKey: white,
  blackPlayerName: "Black player",
  whitePlayerName: "White player",
};

test("opponent presentation is derived only for one exact participant", () => {
  assert.deepEqual(deriveGameOpponent(participants, black), {
    playerKey: white,
    playerName: "White player",
  });
  assert.deepEqual(deriveGameOpponent(participants, white), {
    playerKey: black,
    playerName: "Black player",
  });
  assert.equal(deriveGameOpponent(participants, "guest:outsider"), null);
  assert.equal(deriveGameOpponent({
    ...participants,
    whitePlayerKey: black,
  }, black), null);
});

test("block responses must echo the current actor and a boolean state", () => {
  assert.equal(parsePlayerBlockState({ actor: black, blocked: true }, black), true);
  assert.equal(parsePlayerBlockState({ actor: black, blocked: false }, black), false);
  for (const value of [
    null,
    { actor: white, blocked: true },
    { actor: black, blocked: "yes" },
  ]) {
    assert.throws(
      () => parsePlayerBlockState(value, black),
      (error: unknown) => error instanceof ApiRequestError,
    );
  }
});

test("unavailable chat snapshots cannot carry hidden message rows", () => {
  assert.deepEqual(parseGameChatSnapshot({ available: false, messages: [] }), {
    available: false,
    messages: [],
  });
  assert.deepEqual(parseGameChatSnapshot({ available: true, messages: [] }), {
    available: true,
    messages: [],
  });
  assert.deepEqual(parseGameChatSnapshot({
    available: true,
    messages: [{
      id: "42",
      playerKey: white,
      playerName: "White player",
      message: "Good game",
      createdAt: "2026-07-28T10:00:00.000Z",
      ignoredFutureField: true,
    }],
  }), {
    available: true,
    messages: [{
      id: "42",
      playerKey: white,
      playerName: "White player",
      message: "Good game",
      createdAt: "2026-07-28T10:00:00.000Z",
    }],
  });
  for (const value of [
    { available: false, messages: [{ id: "1" }] },
    { available: "no", messages: [] },
    { available: true, messages: null },
    { available: true, messages: [{
      id: "0",
      playerKey: white,
      playerName: "White player",
      message: "Hello",
      createdAt: "2026-07-28T10:00:00.000Z",
    }] },
    { available: true, messages: Array(1) },
    { available: true, messages: Array.from({ length: 101 }, () => ({})) },
  ]) {
    assert.throws(
      () => parseGameChatSnapshot(value),
      (error: unknown) => error instanceof ApiRequestError,
    );
  }
});

test("sent chat responses verify both actor and message fields", () => {
  const message = {
    id: "7",
    playerKey: black,
    playerName: "Black player",
    message: "Hello",
    createdAt: "2026-07-28T10:00:00.000Z",
  };
  assert.deepEqual(parseSentGameMessage({ actor: black, message }, black), message);
  for (const value of [
    { actor: white, message },
    { actor: black, message: { ...message, playerKey: white } },
    { actor: black, message: { ...message, id: "not-an-id" } },
    { actor: black, message: { ...message, createdAt: "not-a-date" } },
  ]) {
    assert.throws(
      () => parseSentGameMessage(value, black),
      (error: unknown) => error instanceof ApiRequestError,
    );
  }
});

test("block confirmation does not invent a rated result", () => {
  assert.match(en.game.blockDescription, /does not change whether it affects your rating/i);
  assert.match(de.game.blockDescription, /deine Wertung beeinflusst.*nicht/i);
  assert.doesNotMatch(en.game.blockDescription, /remain rated/i);
  assert.doesNotMatch(de.game.blockDescription, /bleibt gewertet/i);
});
