import assert from "node:assert/strict";
import test from "node:test";
import { toGtpCoordinate } from "./coordinates";
import { buildGameAnalysis, classifyMove } from "./evaluate";
import type { AnalysisInput, KataGoTurnResult } from "./types";

test("converts board coordinates to GTP without the I column", () => {
  assert.equal(toGtpCoordinate(19, { x: 0, y: 18, isPass: false }), "A1");
  assert.equal(toGtpCoordinate(19, { x: 8, y: 0, isPass: false }), "J19");
  assert.equal(toGtpCoordinate(9, { x: null, y: null, isPass: true }), "pass");
});

test("classifies engine loss with a deliberately narrow brilliant threshold", () => {
  assert.equal(classifyMove(0.005, true, 0.1), "brilliant");
  assert.equal(classifyMove(0.01, false, 0), "great");
  assert.equal(classifyMove(0.08, false, 0), "inaccuracy");
  assert.equal(classifyMove(0.18, false, 0), "mistake");
  assert.equal(classifyMove(0.3, false, 0), "blunder");
});

test("compares a played move with KataGo alternatives from the mover perspective", () => {
  const input: AnalysisInput = {
    contractVersion: 1,
    gameId: "00000000-0000-4000-8000-000000000001",
    gameVersion: 3,
    boardSize: 9,
    komi: 7.5,
    rules: "chinese",
    moves: [{ color: "black", move: "E5" }],
  };
  const turns: KataGoTurnResult[] = [
    {
      turnNumber: 0,
      rootInfo: { currentPlayer: "B", visits: 100, winrate: 0.55, scoreLead: 1 },
      moveInfos: [
        { move: "C3", order: 0, visits: 80, winrate: 0.6, scoreLead: 2.5, pv: ["C3", "G7"] },
        { move: "E5", order: 1, visits: 20, winrate: 0.5, scoreLead: 0, pv: ["E5"] },
      ],
    },
    {
      turnNumber: 1,
      rootInfo: { currentPlayer: "W", visits: 100, winrate: 0.52, scoreLead: 0.5 },
      moveInfos: [{ move: "C3", order: 0, visits: 100, winrate: 0.52, scoreLead: 0.5, pv: ["C3"] }],
    },
  ];
  const result = buildGameAnalysis(input, turns, { version: "test", model: "test-model", visitsPerTurn: 100 }, "2026-01-01T00:00:00.000Z");
  assert.equal(result.moves[0].winrateAfter, 0.48);
  assert.equal(result.moves[0].winrateLoss, 0.12);
  assert.equal(result.moves[0].bestMove, "C3");
  assert.match(result.moves[0].explanation.de, /C3 ist stärker als E5/);
  assert.equal(result.summary.inaccuracy, 1);
});
