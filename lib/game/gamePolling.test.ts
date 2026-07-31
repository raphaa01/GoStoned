import assert from "node:assert/strict";
import test from "node:test";
import { en } from "@/lib/i18n/catalogs/en";
import { describeGameChange } from "./gameAccessibility";
import {
  FULL_GAME_REFRESH_INTERVAL_MS,
  gamePollResponseBody,
  gamePollUrl,
  gameStateFromPoll,
  MAX_PERSISTED_GAME_VERSION,
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

test("known game versions distinguish full refreshes from invalid canonical queries", () => {
  for (const [query, expected] of [
    ["", { kind: "full" }],
    ["?knownVersion=0", { kind: "version", knownVersion: 0 }],
    ["?knownVersion=17", { kind: "version", knownVersion: 17 }],
    [
      `?knownVersion=${MAX_PERSISTED_GAME_VERSION}`,
      { kind: "version", knownVersion: MAX_PERSISTED_GAME_VERSION },
    ],
    ["?knownVersion=", { kind: "invalid" }],
    ["?knownVersion=-1", { kind: "invalid" }],
    ["?knownVersion=+1", { kind: "invalid" }],
    ["?knownVersion=1.5", { kind: "invalid" }],
    ["?knownVersion=01", { kind: "invalid" }],
    ["?knownVersion=1&knownVersion=1", { kind: "invalid" }],
    ["?knownVersion=2147483648", { kind: "invalid" }],
    ["?knownVersion=9007199254740992", { kind: "invalid" }],
    ["?unknown=1", { kind: "invalid" }],
    ["?knownVersion=1&unknown=1", { kind: "invalid" }],
    ["?knownVersion=%31", { kind: "invalid" }],
    ["?known%56ersion=1", { kind: "invalid" }],
  ] as const) {
    assert.deepEqual(parseKnownGameVersion(query), expected);
  }
});

test("poll URLs request deltas between periodic full integrity refreshes", () => {
  const now = 1_000_000;
  assert.equal(gamePollUrl("game one", -1, 0, now), "/api/games/game%20one");
  assert.equal(
    gamePollUrl("game one", MAX_PERSISTED_GAME_VERSION + 1, now - 1_000, now),
    "/api/games/game%20one",
  );
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
  }, 1_000_000);
  assert.ok(next);
  assert.notEqual(next, current);
  assert.notEqual(next.clock, nextClock);
  assert.equal(next.clock.serverNow, nextClock.serverNow);
  assert.equal(next.clock.clientReceivedAt, 1_000_000);
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
  const replacement = {
    ...current,
    version: 5,
    clock: clock({ serverNow: "2026-07-28T10:01:00.000Z" }),
  };
  const accepted = gameStateFromPoll(current, { game: replacement }, 1_000_000);
  assert.ok(accepted);
  assert.equal(accepted.version, 5);
  assert.equal(accepted.clock.clientReceivedAt, 1_000_000);

  const receivedAt = 1_000_000;
  assert.equal(
    gamePollUrl(replacement.id, replacement.version, receivedAt, receivedAt + 900),
    "/api/games/game%20one?knownVersion=5",
  );
});

test("poll application is monotonic across versions and authoritative clock anchors", () => {
  const current = gameState();
  const newerClock = clock({ serverNow: "2026-07-28T10:00:01.000Z" });
  const olderClock = clock({ serverNow: "2026-07-28T09:59:59.000Z" });
  assert.ok(gameStateFromPoll(current, {
    unchanged: true,
    gameId: current.id,
    version: current.version,
    clock: newerClock,
  }, 2_000));
  assert.equal(gameStateFromPoll(current, {
    unchanged: true,
    gameId: current.id,
    version: current.version,
    clock: olderClock,
  }, 3_000), null);
  assert.equal(gameStateFromPoll(current, {
    unchanged: true,
    gameId: current.id,
    version: current.version,
    clock: current.clock,
  }, 3_000), null);
  assert.equal(gameStateFromPoll(current, {
    unchanged: true,
    gameId: current.id,
    version: current.version,
    clock: clock({ serverNow: "not-a-date" }),
  }, 3_000), null);

  assert.equal(gameStateFromPoll(current, {
    game: { ...current, id: "another-game", version: 5, clock: newerClock },
  }, 3_000), null);
  assert.equal(gameStateFromPoll(current, {
    game: { ...current, version: 3, clock: newerClock },
  }, 3_000), null);
  assert.ok(gameStateFromPoll(current, {
    game: { ...current, version: 5, clock: olderClock },
  }, 3_000));
});

test("a verified terminal state cannot regress to active", () => {
  const finished = {
    ...gameState(),
    status: "finished" as const,
    turn: null,
    result: "B+R",
    finishReason: "resignation" as const,
    winnerKey: "guest:black",
    finishedAt: "2026-07-28T10:00:00.000Z",
    version: 5,
    clock: clock({ serverNow: "2026-07-28T10:01:00.000Z" }),
  };
  assert.equal(gameStateFromPoll(finished, {
    game: {
      ...gameState(),
      version: 6,
      clock: clock({ serverNow: "2026-07-28T10:02:00.000Z" }),
    },
  }), null);
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
