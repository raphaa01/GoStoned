import assert from "node:assert/strict";
import test from "node:test";
import { toGtpCoordinate } from "./coordinates";
import { buildGameAnalysis, buildProgressiveGameAnalysis, classifyMove } from "./evaluate";
import type { AnalysisInput, KataGoTurnResult } from "./types";

test("converts board coordinates to GTP without the I column", () => {
  assert.equal(toGtpCoordinate(19, { x: 0, y: 18, isPass: false }), "A1");
  assert.equal(toGtpCoordinate(19, { x: 8, y: 0, isPass: false }), "J19");
  assert.equal(toGtpCoordinate(9, { x: null, y: null, isPass: true }), "pass");
});

test("reserves brilliant and blunder for strong, corroborated evidence", () => {
  assert.equal(classifyMove(0.003, true, 0.16, 0.3, 160), "brilliant");
  assert.equal(classifyMove(0.003, true, 0.16, 0.3, 4), "best");
  assert.equal(classifyMove(0.01, false, 0, 0.5, 160), "great");
  assert.equal(classifyMove(0.12, false, 0, 2, 160), "inaccuracy");
  assert.equal(classifyMove(0.2, false, 0, 3, 160), "mistake");
  assert.equal(classifyMove(0.4, false, 0, 6, 160), "blunder");
  assert.equal(classifyMove(0.4, false, 0, 6, 4), "inaccuracy");
  assert.equal(classifyMove(0.4, false, 0, 2, 160), "mistake");
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

test("accepts legacy percentage-scaled KataGo winrates without producing 10000 percent", () => {
  const input: AnalysisInput = {
    contractVersion: 1,
    gameId: "00000000-0000-4000-8000-000000000002",
    gameVersion: 2,
    boardSize: 9,
    komi: 7.5,
    rules: "chinese",
    moves: [{ color: "black", move: "E5" }],
  };
  const turns: KataGoTurnResult[] = [
    {
      turnNumber: 0,
      rootInfo: { currentPlayer: "B", visits: 50, winrate: 55, scoreLead: 1 },
      moveInfos: [{ move: "C3", order: 0, visits: 50, winrate: 60, scoreLead: 2, pv: ["C3"] }],
    },
    {
      turnNumber: 1,
      rootInfo: { currentPlayer: "W", visits: 50, winrate: 52, scoreLead: 0 },
      moveInfos: [{ move: "E5", order: 0, visits: 50, winrate: 52, scoreLead: 0, pv: ["E5"] }],
    },
  ];
  const result = buildGameAnalysis(input, turns, { version: "test", model: "test", visitsPerTurn: 50 });
  assert.equal(result.moves[0].winrateBefore, 0.55);
  assert.equal(result.moves[0].winrateAfter, 0.48);
  assert.equal(result.moves[0].alternatives[0].winrate, 0.6);
});

test("builds a usable contiguous review while later turns are still loading", () => {
  const input = {
    contractVersion: 1 as const,
    gameId: "progressive",
    gameVersion: 3,
    boardSize: 9 as const,
    komi: 6.5,
    rules: "japanese" as const,
    moves: [
      { color: "black" as const, move: "D4" },
      { color: "white" as const, move: "E5" },
      { color: "black" as const, move: "C3" },
    ],
  };
  const turn = (turnNumber: number) => ({
    turnNumber,
    rootInfo: { currentPlayer: turnNumber % 2 === 0 ? "B" as const : "W" as const, visits: 1, winrate: 0.5, scoreLead: 0 },
    moveInfos: [{ move: input.moves[turnNumber]?.move ?? "F6", order: 0, visits: 1, winrate: 0.5, scoreLead: 0, pv: ["F6"] }],
  });
  const partial = buildProgressiveGameAnalysis(
    input,
    [turn(0), turn(1), turn(3)],
    { version: "test", model: "test", visitsPerTurn: 1 },
  );
  assert.equal(partial?.moves.length, 1);
  assert.equal(partial?.moves[0].playedMove, "D4");
  assert.equal(buildProgressiveGameAnalysis(input, [turn(1)], { version: "test", model: "test", visitsPerTurn: 1 }), null);
});

test("accepts actual one-visit root-only mobile results without inventing recommendations", () => {
  const input: AnalysisInput = {
    contractVersion: 1,
    gameId: "root-only-preview",
    gameVersion: 50,
    boardSize: 9,
    komi: 6.5,
    rules: "japanese",
    moves: [{ color: "black", move: "G3" }],
  };
  // Captured from the API-36 engine that triggered the regression: maxVisits=1
  // legitimately returns a root evaluation with no visited child moves.
  const turns: KataGoTurnResult[] = [
    {
      turnNumber: 1,
      rootInfo: { currentPlayer: "W", visits: 1, winrate: 0.905167356, scoreLead: 1.50781643 },
      moveInfos: [],
    },
    {
      turnNumber: 0,
      rootInfo: { currentPlayer: "B", visits: 1, winrate: 0.260774001, scoreLead: -0.610248089 },
      moveInfos: [],
    },
  ];
  const engine = { version: "v1.18.2", model: "b10c384h6nbttflrs", visitsPerTurn: 1 };
  const result = buildProgressiveGameAnalysis(input, turns, engine, undefined, { allowRootOnly: true });
  assert.equal(result?.moves.length, 1);
  const move = result!.moves[0];
  assert.equal(move.winrateAfter, 1 - turns[0].rootInfo.winrate);
  assert.equal(move.scoreLeadAfter, -turns[0].rootInfo.scoreLead);
  assert.equal(move.bestMove, null);
  assert.equal(move.classification, null);
  assert.equal(move.winrateLoss, null);
  assert.equal(move.scoreLoss, null);
  assert.deepEqual(move.alternatives, []);
  assert.equal(Object.values(result!.summary).reduce((sum, count) => sum + count, 0), 0);
  assert.match(move.explanation.de, /noch keine geprüfte/);
  // Server analyses keep their existing searched-candidate requirement.
  assert.throws(() => buildGameAnalysis(input, turns, engine), /complete result for move 1/);

  turns[1] = {
    ...turns[1],
    rootInfo: { ...turns[1].rootInfo, visits: 20 },
    moveInfos: [{ move: "C3", order: 0, visits: 19, winrate: 0.5, scoreLead: 0, pv: ["C3", "G7"] }],
  };
  const refined = buildProgressiveGameAnalysis(input, turns, engine, undefined, { allowRootOnly: true });
  assert.equal(refined?.moves[0].bestMove, "C3");
  assert.notEqual(refined?.moves[0].classification, null);
});
