import assert from "node:assert/strict";
import test from "node:test";
import type { KataGoMoveInfo } from "@/lib/analysis/types";
import { botDifficultyForRating, selectBotMove } from "./difficulty";
import { botDisplayName, deterministicUnit } from "./identity";

const candidates: KataGoMoveInfo[] = Array.from({ length: 8 }, (_, index) => ({
  move: `${String.fromCharCode(65 + index)}4`,
  order: index,
  visits: 100 - index * 10,
  winrate: 0.6 - index * 0.02,
  scoreLead: 5 - index,
  pv: [],
}));

test("bot search effort rises and variation narrows with rating", () => {
  const beginner = botDifficultyForRating(600);
  const intermediate = botDifficultyForRating(1200);
  const expert = botDifficultyForRating(2200);
  assert.ok(beginner.visitsPerTurn < intermediate.visitsPerTurn);
  assert.ok(intermediate.visitsPerTurn < expert.visitsPerTurn);
  assert.ok(beginner.candidateLimit > intermediate.candidateLimit);
  assert.equal(expert.candidateLimit, 1);
  assert.ok(beginner.temperature > expert.temperature);
});

test("expert bot always takes KataGo's first candidate", () => {
  const expert = botDifficultyForRating(2200);
  assert.equal(selectBotMove(candidates, expert, 0.999, { moveNumber: 40, boardSize: 9 }).move, "A4");
});

test("early move selection excludes pass when board moves exist", () => {
  const beginner = botDifficultyForRating(600);
  const withPass = [{ ...candidates[0], move: "pass" }, ...candidates.slice(1)];
  assert.notEqual(selectBotMove(withPass, beginner, 0, { moveNumber: 2, boardSize: 9 }).move, "pass");
});

test("bot identities and random units are stable for a game seed", () => {
  assert.equal(botDisplayName("game-1"), botDisplayName("game-1"));
  assert.equal(deterministicUnit("game-1:4"), deterministicUnit("game-1:4"));
  assert.ok(deterministicUnit("game-1:4") >= 0 && deterministicUnit("game-1:4") < 1);
});
