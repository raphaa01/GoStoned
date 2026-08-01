import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayMovesWithPrisoners } from "@/lib/game/goEngine";
import type { GameState, Stone, StoredMove } from "@/lib/game/types";
import {
  chooseLocalBotMove,
  localBotProfileForRating,
  localBotThinkDelayMs,
  type LocalBotMove,
} from "./localBot";
import { isMatchingLocalBotMove } from "./localBotService";

const now = "2026-08-01T12:00:00.000Z";

function storedMove(
  moveNumber: number,
  color: Stone,
  x: number,
  y: number,
): StoredMove {
  return { moveNumber, color, x, y, isPass: false, createdAt: now };
}

function gameState(moves: StoredMove[] = []): GameState {
  const board = replayMovesWithPrisoners(9, moves).board;
  return {
    id: "33333333-3333-4333-8333-333333333333",
    boardSize: 9,
    blackPlayerKey: "bot:44444444-4444-4444-8444-444444444444",
    whitePlayerKey: "user:11111111-1111-4111-8111-111111111111",
    blackPlayerName: "QuietPanda",
    whitePlayerName: "Player",
    blackPlayerIsBot: true,
    whitePlayerIsBot: false,
    botTargetRating: 1_200,
    winnerKey: null,
    rated: true,
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
    version: moves.length,
    startedAt: now,
    finishedAt: null,
    timeControl: "rapid",
    clock: {
      serverNow: now,
      mainTimeSeconds: 900,
      byoYomiPeriods: 5,
      byoYomiSeconds: 30,
      black: { mainTimeMs: 900_000, periodsRemaining: 5, displayTimeMs: 900_000, phase: "main" },
      white: { mainTimeMs: 900_000, periodsRemaining: 5, displayTimeMs: 900_000, phase: "main" },
    },
    turn: moves.length % 2 === 0 ? "black" : "white",
    moveCount: moves.length,
    board,
    moves,
  };
}

test("ratings select five progressively stricter local bot levels", () => {
  assert.deepEqual(
    [500, 900, 1_200, 1_600, 2_100].map((rating) => localBotProfileForRating(rating).level),
    ["novice", "beginner", "intermediate", "advanced", "strongest"],
  );
  assert.deepEqual(
    [500, 900, 1_200, 1_600, 2_100].map((rating) => localBotProfileForRating(rating).candidateLimit),
    [12, 8, 5, 3, 1],
  );
});

test("a local bot decision is deterministic for server verification", () => {
  const game = gameState();
  const first = chooseLocalBotMove({ game, targetRating: 1_200 });
  const second = chooseLocalBotMove({ game, targetRating: 1_200 });
  assert.deepEqual(first, second);
  assert.equal(isMatchingLocalBotMove(first, { action: "move", expectedVersion: 0, ...first }), true);
  const forged: LocalBotMove = first.isPass ? { x: 0, y: 0 } : { x: (first.x + 1) % 9, y: first.y };
  assert.equal(isMatchingLocalBotMove(first, { action: "move", expectedVersion: 0, ...forged }), false);
});

test("the heuristic takes an immediately capturable stone", () => {
  const game = gameState([
    storedMove(1, "black", 0, 1),
    storedMove(2, "white", 1, 1),
    storedMove(3, "black", 1, 0),
    storedMove(4, "white", 8, 8),
    storedMove(5, "black", 2, 1),
    storedMove(6, "white", 7, 8),
  ]);
  assert.deepEqual(chooseLocalBotMove({ game, targetRating: 2_100 }), { x: 1, y: 2 });
});

test("every deterministic think delay stays below ten seconds", () => {
  for (let version = 0; version < 100; version += 1) {
    const delay = localBotThinkDelayMs("game", version);
    assert.ok(delay >= 3_000);
    assert.ok(delay <= 9_000);
  }
});

test("the bot is lazily loaded in a Web Worker without models or storage", () => {
  const room = readFileSync(new URL("../../components/game/GameRoom.tsx", import.meta.url), "utf8");
  const browserClient = readFileSync(new URL("./browserClient.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("./localBot.worker.ts", import.meta.url), "utf8");
  const core = readFileSync(new URL("./localBot.ts", import.meta.url), "utf8");
  assert.match(room, /await import\("@\/lib\/bot\/browserClient"\)/);
  assert.match(browserClient, /new Worker\(new URL\("\.\/localBot\.worker\.ts"/);
  assert.match(worker, /chooseLocalBotMove/);
  for (const source of [browserClient, worker, core]) {
    assert.doesNotMatch(source, /fetch\(|indexedDB|CacheStorage|\.bin\b|KataGo/i);
  }
});

test("ranked bot moves are recomputed on the server before persistence", () => {
  const service = readFileSync(new URL("./localBotService.ts", import.meta.url), "utf8");
  assert.match(service, /chooseLocalBotMove\(\{ game, targetRating: bot\.target_rating \}\)/);
  assert.match(service, /local_bot_move_mismatch/);
  assert.match(service, /submitMove\(gameId, bot\.bot_player_key/);
});
