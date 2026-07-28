import assert from "node:assert/strict";
import test from "node:test";
import { en } from "@/lib/i18n/catalogs/en";
import { describeGameChange } from "./gameAccessibility";
import {
  FULL_GAME_REFRESH_INTERVAL_MS,
  gamePollResponseBody,
  gamePollUrl,
  gameStateFromPoll,
  parseKnownGameVersion,
} from "./gamePolling";
import type { GameClockState, GameState } from "./types";

function clock(overrides: Partial<GameClockState> = {}): GameClockState {
  return {
    serverNow: "2026-07-28T10:00:00.000Z",
    mainTimeSeconds: 600,
    byoYomiPeriods: 5,
    byoYomiSeconds: 30,
    black: {
      mainTimeMs: 500_000,
      periodsRemaining: 5,
      displayTimeMs: 500_000,
      phase: "main",
    },
    white: {
      mainTimeMs: 600_000,
      periodsRemaining: 5,
      displayTimeMs: 600_000,
      phase: "main",
    },
    ...overrides,
  };
}

function gameState(): GameState {
  return {
    id: "game one",
    boardSize: 9,
    blackPlayerKey: "guest:black",
    whitePlayerKey: "guest:white",
    blackPlayerName: "Black",
    whitePlayerName: "White",
    winnerKey: null,
    rated: false,
    status: "active",
    phase: "play",
    result: null,
    finishReason: null,
    komi: 7.5,
    ruleset: "chinese",
    rulesProfile: "chinese-2002-gostone-v1",
    scoringMethod: "area",
    handicap: 0,
    consecutivePasses: 0,
    scoringRevision: 0,
    scoring: null,
    lastResume: null,
    version: 4,
    startedAt: "2026-07-28T09:00:00.000Z",
    finishedAt: null,
    timeControl: "rapid",
    clock: clock(),
    turn: "black",
    moveCount: 0,
    board: Array.from({ length: 9 }, () => Array(9).fill(null)),
    moves: [],
  };
}

test("known game versions are strict, singular, nonnegative safe integers", () => {
  for (const [query, expected] of [
    ["", null],
    ["knownVersion=0", 0],
    ["knownVersion=17", 17],
    ["knownVersion=-1", null],
    ["knownVersion=1.5", null],
    ["knownVersion=01", null],
    ["knownVersion=1&knownVersion=1", null],
    ["knownVersion=9007199254740992", null],
  ] as const) {
    assert.equal(parseKnownGameVersion(new URLSearchParams(query)), expected);
  }
});

test("poll URLs request deltas between periodic full integrity refreshes", () => {
  const now = 1_000_000;
  assert.equal(gamePollUrl("game one", -1, 0, now), "/api/games/game%20one");
  assert.equal(gamePollUrl("game one", 4, now - 1_000, now), "/api/games/game%20one?knownVersion=4");
  assert.equal(
    gamePollUrl("game one", 4, now - FULL_GAME_REFRESH_INTERVAL_MS, now),
    "/api/games/game%20one",
  );
});

test("heartbeats update only the authoritative clock for the matching cached version", () => {
  const current = gameState();
  const nextClock = clock({
    serverNow: "2026-07-28T10:01:00.000Z",
    black: {
      mainTimeMs: 0,
      periodsRemaining: 5,
      displayTimeMs: 25_000,
      phase: "byo-yomi",
    },
  });
  const next = gameStateFromPoll(current, {
    unchanged: true,
    gameId: current.id,
    version: current.version,
    clock: nextClock,
  });
  assert.ok(next);
  assert.notEqual(next, current);
  assert.equal(next.clock, nextClock);
  assert.equal(next.board, current.board);
  assert.equal(next.moves, current.moves);
  assert.equal(next.scoring, current.scoring);
  assert.equal(next.status, current.status);
  assert.equal(next.version, current.version);
  assert.equal(
    describeGameChange(current, next, en.game),
    "Black entered byo-yomi with 5 periods remaining.",
  );

  assert.equal(gameStateFromPoll(null, {
    unchanged: true,
    gameId: current.id,
    version: current.version,
    clock: nextClock,
  }), null);
  assert.equal(gameStateFromPoll(current, {
    unchanged: true,
    gameId: "another-game",
    version: current.version,
    clock: nextClock,
  }), null);
  assert.equal(gameStateFromPoll(current, {
    unchanged: true,
    gameId: current.id,
    version: current.version - 1,
    clock: nextClock,
  }), null);
});

test("full poll responses replace the cached state", () => {
  const current = gameState();
  const replacement = { ...current, version: 5 };
  assert.equal(gameStateFromPoll(current, { game: replacement }), replacement);

  const receivedAt = 1_000_000;
  assert.equal(
    gamePollUrl(replacement.id, replacement.version, receivedAt, receivedAt + 900),
    "/api/games/game%20one?knownVersion=5",
  );
});

test("route payloads keep the legacy full shape and add a distinct heartbeat", () => {
  const game = gameState();
  assert.deepEqual(gamePollResponseBody({ unchanged: false, game }), { ok: true, game });
  const heartbeat = {
    unchanged: true as const,
    gameId: game.id,
    version: game.version,
    clock: game.clock,
  };
  assert.deepEqual(gamePollResponseBody(heartbeat), { ok: true, ...heartbeat });
});
