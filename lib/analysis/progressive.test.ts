import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisInput, KataGoTurnResult } from "./types";
import { analyzeGameProgressively } from "./progressive";

const input: AnalysisInput = {
  contractVersion: 1,
  gameId: "00000000-0000-4000-8000-000000000001",
  gameVersion: 12,
  boardSize: 9,
  komi: 6.5,
  rules: "japanese",
  moves: Array.from({ length: 23 }, (_, index) => ({
    color: index % 2 === 0 ? "black" as const : "white" as const,
    move: `${String.fromCharCode(65 + (index % 8))}${(index % 8) + 1}`,
  })),
};

function result(turnNumber: number, visits: number): KataGoTurnResult {
  const currentPlayer = turnNumber % 2 === 0 ? "B" as const : "W" as const;
  return {
    turnNumber,
    rootInfo: { currentPlayer, visits, winrate: 0.55, scoreLead: 1.5 },
    moveInfos: [{
      move: "A1",
      order: 0,
      visits,
      winrate: 0.56,
      scoreLead: 1.7,
      pv: ["A1", "B1"],
    }],
  };
}

test("publishes a ten-move preview before refining the complete game", async () => {
  const calls: Array<{ turns: number[]; visits: number; phase: string }> = [];
  const updates: Array<{ moves: number; phase: string; refined: number }> = [];

  const final = await analyzeGameProgressively({
    input,
    engineVersion: "test",
    modelName: "test-model",
    previewVisits: 4,
    qualityVisits: 160,
    chunkMoves: 10,
    analyzedAt: "2026-10-01T12:00:00.000Z",
    analyzePositions: async (turnNumbers, visits, phase) => {
      calls.push({ turns: [...turnNumbers], visits, phase });
      return turnNumbers.map((turn) => result(turn, visits));
    },
    publish: async (analysis, progress) => {
      updates.push({
        moves: analysis.moves.length,
        phase: progress.phase,
        refined: progress.refinedMoves,
      });
    },
  });

  assert.deepEqual(calls.map((call) => [call.phase, call.visits, call.turns]), [
    ["preview", 4, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ["preview", 4, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]],
    ["preview", 4, [21, 22, 23]],
    ["quality", 160, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ["quality", 160, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]],
    ["quality", 160, [21, 22, 23]],
  ]);
  assert.deepEqual(updates, [
    { moves: 10, phase: "preview", refined: 0 },
    { moves: 20, phase: "preview", refined: 0 },
    { moves: 23, phase: "preview", refined: 0 },
    { moves: 23, phase: "quality", refined: 10 },
    { moves: 23, phase: "quality", refined: 20 },
    { moves: 23, phase: "quality", refined: 23 },
  ]);
  assert.equal(final.moves.length, 23);
  assert.equal(final.engine.visitsPerTurn, 160);
});
