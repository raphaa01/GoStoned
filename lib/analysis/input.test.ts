import assert from "node:assert/strict";
import test from "node:test";
import { gameAnalysisInput } from "./input";
import type { GameState } from "@/lib/game/types";

test("builds the same portable analysis input for server and mobile engines", () => {
  const game = {
    id: "11111111-1111-4111-8111-111111111111",
    version: 3,
    boardSize: 9,
    komi: 6.5,
    ruleset: "japanese",
    moves: [
      { color: "black", x: 0, y: 8, isPass: false },
      { color: "white", x: null, y: null, isPass: true },
    ],
  } as unknown as GameState;
  assert.deepEqual(gameAnalysisInput(game), {
    contractVersion: 1,
    gameId: game.id,
    gameVersion: 3,
    boardSize: 9,
    komi: 6.5,
    rules: "japanese",
    moves: [
      { color: "black", move: "A1" },
      { color: "white", move: "pass" },
    ],
  });
});
